-- Security/perf hardening from the 2026-09-13 Supabase advisor pass. Every step
-- is idempotent and guarded so it is safe on fixtures that lack the object.

-- 1) crm_contact_timeline ran as its creator (SECURITY DEFINER) and was granted to
--    anon/authenticated: any holder of the publishable key could read every org's
--    messages through PostgREST. Only the hub server reads it (app_ledger, under
--    the base tables' org-GUC policies), so run it as the invoker and drop the
--    browser grants.
DO $$ BEGIN
  IF to_regclass('public.crm_contact_timeline') IS NOT NULL THEN
    ALTER VIEW public.crm_contact_timeline SET (security_invoker = on);
    REVOKE ALL ON public.crm_contact_timeline FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 2) SECURITY DEFINER maintenance functions were callable by anon/authenticated via
--    /rest/v1/rpc. They are server/cron entry points; keep postgres + service_role.
DO $$ DECLARE fn regprocedure; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    to_regprocedure('public.crm_refresh_sentiment_chat_daily(text,date,date)'),
    to_regprocedure('public.crm_refresh_word_frequency_daily(date,date)'),
    to_regprocedure('public.rls_auto_enable()')
  ] LOOP
    IF fn IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;

-- 3) Pin the one function the linter found with a role-mutable search_path.
DO $$ BEGIN
  IF to_regprocedure('public.job_effect_vectors_valid(jsonb,integer)') IS NOT NULL THEN
    ALTER FUNCTION public.job_effect_vectors_valid(jsonb,integer) SET search_path = pg_catalog, public;
  END IF;
END $$;

-- 4) Realtime only maintains realtime.messages partitions for tenants a client has
--    connected to. With nobody connected, realtime.send() has no partition and
--    raises a warning on every message insert (50 MB of worker log). A broadcast
--    with no listener is worthless anyway, so skip it when today's partition is
--    missing. Partitions are named messages_YYYY_MM_DD on the UTC day.
CREATE OR REPLACE FUNCTION public.hub_broadcast_message_committed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
begin
  if to_regclass('realtime.messages_' || to_char(now() at time zone 'utc', 'YYYY_MM_DD')) is null then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'version', 1,
      'id', new.id,
      'clientId', new.client_id,
      'channel', new.channel,
      'accountId', new.account_id,
      'chatId', new.chat_id,
      'direction', new.direction,
      'occurredAt', coalesce(new.occurred_at, new.created_at)
    ),
    'message.committed',
    'org:' || new.org_id || ':events',
    true
  );
  return null;
end;
$$;

-- 5) "Auth RLS Initialization Plan": auth.uid() evaluated per row. Wrapping it as
--    (select auth.uid()) makes it an InitPlan evaluated once per statement. Same
--    truth table; rebuilt from each policy's own deparsed expressions so nothing
--    is retyped by hand. Roles and commands are untouched by ALTER POLICY.
DO $$ DECLARE p record; stmt text; BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual,'') || coalesce(with_check,'')) ~ 'auth\.uid\(\)'
      AND (coalesce(qual,'') || coalesce(with_check,'')) !~* '\(\s*select\s+auth\.uid\(\)'
  LOOP
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF p.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', replace(p.qual, 'auth.uid()', '(select auth.uid())'));
    END IF;
    IF p.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', replace(p.with_check, 'auth.uid()', '(select auth.uid())'));
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;
