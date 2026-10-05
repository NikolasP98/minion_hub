-- HS-009 / HS-012 / HS-029: currency-isolated wallets, identity/settings
-- serialization, immutable grant denomination and append-only ledger grants.

CREATE OR REPLACE FUNCTION public.pos_advisory_key_v1(
  lock_kind text,
  organization_id text,
  subject text DEFAULT '',
  currency text DEFAULT ''
) RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
BEGIN
  IF lock_kind IS NULL OR lock_kind NOT IN ('settings', 'identity', 'wallet', 'grant-source') THEN
    RAISE EXCEPTION 'invalid POS advisory lock kind' USING ERRCODE = '22023';
  END IF;
  IF organization_id IS NULL OR organization_id = '' THEN
    RAISE EXCEPTION 'organization id is required' USING ERRCODE = '22023';
  END IF;
  IF lock_kind = 'grant-source' AND (subject IS NULL OR subject = '') THEN
    RAISE EXCEPTION 'grant source subject is required' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(
      'minion.pos.lock', 1, lock_kind, organization_id,
      COALESCE(subject, ''), COALESCE(currency, '')
    )::text,
    0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_advisory_key_v1(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_advisory_key_v1(text,text,text,text) TO app_ledger;

CREATE OR REPLACE FUNCTION public.pos_lock_identity_orgs_v1(org_ids text[])
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE organization_id text;
BEGIN
  FOR organization_id IN
    SELECT value
    FROM (
      SELECT DISTINCT value
      FROM pg_catalog.unnest(org_ids) value
      WHERE value IS NOT NULL AND value <> ''
    ) distinct_orgs
    ORDER BY value COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      public.pos_advisory_key_v1('identity', organization_id, '', '')
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_lock_identity_orgs_v1(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_lock_identity_orgs_v1(text[]) TO app_ledger;

CREATE OR REPLACE FUNCTION public.pos_contact_identity_insert_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  SELECT pg_catalog.array_agg(n.org_id) INTO orgs FROM new_rows n;
  PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_contact_identity_delete_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  SELECT pg_catalog.array_agg(o.org_id) INTO orgs FROM old_rows o;
  PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_contact_identity_update_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      (SELECT id, org_id, party_id, deleted_at FROM old_rows
       EXCEPT ALL
       SELECT id, org_id, party_id, deleted_at FROM new_rows)
      UNION ALL
      (SELECT id, org_id, party_id, deleted_at FROM new_rows
       EXCEPT ALL
       SELECT id, org_id, party_id, deleted_at FROM old_rows)
    ) changed
  ) THEN
    SELECT pg_catalog.array_agg(x.org_id) INTO orgs
    FROM (
      SELECT org_id FROM old_rows
      UNION
      SELECT org_id FROM new_rows
    ) x;
    PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pos_contact_identity_insert_v1 ON public.crm_contacts;
CREATE TRIGGER pos_contact_identity_insert_v1 AFTER INSERT ON public.crm_contacts
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_contact_identity_insert_v1();
DROP TRIGGER IF EXISTS pos_contact_identity_delete_v1 ON public.crm_contacts;
CREATE TRIGGER pos_contact_identity_delete_v1 AFTER DELETE ON public.crm_contacts
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_contact_identity_delete_v1();
DROP TRIGGER IF EXISTS pos_contact_identity_update_v1 ON public.crm_contacts;
CREATE TRIGGER pos_contact_identity_update_v1 AFTER UPDATE ON public.crm_contacts
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_contact_identity_update_v1();

CREATE OR REPLACE FUNCTION public.pos_party_identity_insert_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  SELECT pg_catalog.array_agg(n.org_id) INTO orgs FROM new_rows n;
  PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_party_identity_delete_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  SELECT pg_catalog.array_agg(o.org_id) INTO orgs FROM old_rows o;
  PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_party_identity_update_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE orgs text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      (SELECT id, org_id FROM old_rows
       EXCEPT ALL
       SELECT id, org_id FROM new_rows)
      UNION ALL
      (SELECT id, org_id FROM new_rows
       EXCEPT ALL
       SELECT id, org_id FROM old_rows)
    ) changed
  ) THEN
    SELECT pg_catalog.array_agg(x.org_id) INTO orgs
    FROM (
      SELECT org_id FROM old_rows
      UNION
      SELECT org_id FROM new_rows
    ) x;
    PERFORM public.pos_lock_identity_orgs_v1(COALESCE(orgs, ARRAY[]::text[]));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pos_party_identity_insert_v1 ON public.parties;
CREATE TRIGGER pos_party_identity_insert_v1 AFTER INSERT ON public.parties
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_party_identity_insert_v1();
DROP TRIGGER IF EXISTS pos_party_identity_delete_v1 ON public.parties;
CREATE TRIGGER pos_party_identity_delete_v1 AFTER DELETE ON public.parties
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_party_identity_delete_v1();
DROP TRIGGER IF EXISTS pos_party_identity_update_v1 ON public.parties;
CREATE TRIGGER pos_party_identity_update_v1 AFTER UPDATE ON public.parties
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_party_identity_update_v1();

CREATE OR REPLACE FUNCTION public.pos_settings_lock_rows_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE organization_id text;
BEGIN
  FOR organization_id IN
    SELECT org_id FROM (
      SELECT DISTINCT x.org_id FROM (
        SELECT org_id FROM old_rows
        UNION SELECT org_id FROM new_rows
      ) x WHERE x.org_id IS NOT NULL
    ) distinct_orgs
    ORDER BY org_id COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      public.pos_advisory_key_v1('settings', organization_id, '', '')
    );
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_settings_lock_insert_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE organization_id text;
BEGIN
  FOR organization_id IN
    SELECT org_id FROM (SELECT DISTINCT org_id FROM new_rows) distinct_orgs
    ORDER BY org_id COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(public.pos_advisory_key_v1('settings', organization_id, '', ''));
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.pos_settings_lock_delete_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE organization_id text;
BEGIN
  FOR organization_id IN
    SELECT org_id FROM (SELECT DISTINCT org_id FROM old_rows) distinct_orgs
    ORDER BY org_id COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(public.pos_advisory_key_v1('settings', organization_id, '', ''));
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pos_settings_lock_insert_v1 ON public.pos_settings;
CREATE TRIGGER pos_settings_lock_insert_v1 AFTER INSERT ON public.pos_settings
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_settings_lock_insert_v1();
DROP TRIGGER IF EXISTS pos_settings_lock_update_v1 ON public.pos_settings;
CREATE TRIGGER pos_settings_lock_update_v1 AFTER UPDATE ON public.pos_settings
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_settings_lock_rows_v1();
DROP TRIGGER IF EXISTS pos_settings_lock_delete_v1 ON public.pos_settings;
CREATE TRIGGER pos_settings_lock_delete_v1 AFTER DELETE ON public.pos_settings
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pos_settings_lock_delete_v1();

CREATE OR REPLACE FUNCTION public.pos_try_lock_grant_sources_v1(source_keys jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE source record;
BEGIN
  FOR source IN
    SELECT org_id, ticket_id
    FROM (
      SELECT DISTINCT value->>'orgId' AS org_id, value->>'ticketId' AS ticket_id
      FROM pg_catalog.jsonb_array_elements(source_keys)
      WHERE value->>'orgId' IS NOT NULL AND value->>'orgId' <> ''
        AND value->>'ticketId' IS NOT NULL AND value->>'ticketId' <> ''
    ) distinct_sources
    ORDER BY org_id COLLATE "C", ticket_id COLLATE "C"
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
      public.pos_advisory_key_v1('grant-source', source.org_id, source.ticket_id, '')
    ) THEN
      RAISE EXCEPTION 'grant source authority changed concurrently' USING ERRCODE = '40001';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_try_lock_grant_sources_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_try_lock_grant_sources_v1(jsonb) TO app_ledger;

CREATE OR REPLACE FUNCTION public.pos_validate_grant_sources_v1(source_rows jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(source_rows) value
    LEFT JOIN public.pos_tickets t
      ON t.org_id = value->>'orgId'
     AND t.id = (value->>'ticketId')::uuid
    WHERE t.id IS NULL
  ) THEN
    RAISE EXCEPTION 'grant source must be a same-organization ticket' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_validate_grant_sources_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_validate_grant_sources_v1(jsonb) TO app_ledger;

CREATE OR REPLACE FUNCTION public.pos_grant_source_insert_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE sources jsonb;
BEGIN
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orgId', n.org_id, 'ticketId', n.source_ticket_id::text
    )), '[]'::jsonb
  ) INTO sources FROM new_rows n;
  PERFORM public.pos_try_lock_grant_sources_v1(sources);
  PERFORM public.pos_validate_grant_sources_v1(sources);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_grant_source_update_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE sources jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM (
      (SELECT org_id, source_ticket_id FROM old_rows
       EXCEPT ALL
       SELECT org_id, source_ticket_id FROM new_rows)
      UNION ALL
      (SELECT org_id, source_ticket_id FROM new_rows
       EXCEPT ALL
       SELECT org_id, source_ticket_id FROM old_rows)
    ) changed
  ) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orgId', x.org_id, 'ticketId', x.source_ticket_id::text
    )), '[]'::jsonb
  ) INTO sources FROM (
    SELECT org_id, source_ticket_id FROM old_rows
    UNION
    SELECT org_id, source_ticket_id FROM new_rows
  ) x;
  PERFORM public.pos_try_lock_grant_sources_v1(sources);
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orgId', n.org_id, 'ticketId', n.source_ticket_id::text
    )), '[]'::jsonb
  ) INTO sources FROM new_rows n;
  PERFORM public.pos_validate_grant_sources_v1(sources);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pos_grant_source_guard_v1 ON public.pos_package_grants;
DROP TRIGGER IF EXISTS pos_grant_source_insert_guard_v1 ON public.pos_package_grants;
CREATE TRIGGER pos_grant_source_insert_guard_v1 AFTER INSERT ON public.pos_package_grants
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.pos_grant_source_insert_guard_v1();
DROP TRIGGER IF EXISTS pos_grant_source_update_guard_v1 ON public.pos_package_grants;
CREATE TRIGGER pos_grant_source_update_guard_v1 AFTER UPDATE ON public.pos_package_grants
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.pos_grant_source_update_guard_v1();

CREATE OR REPLACE FUNCTION public.pos_ticket_grant_update_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE sources jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM (
      (SELECT id, org_id, currency FROM old_rows
       EXCEPT ALL
       SELECT id, org_id, currency FROM new_rows)
      UNION ALL
      (SELECT id, org_id, currency FROM new_rows
       EXCEPT ALL
       SELECT id, org_id, currency FROM old_rows)
    ) changed
  ) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orgId', x.org_id, 'ticketId', x.id::text
    )), '[]'::jsonb
  ) INTO sources FROM (
    SELECT id, org_id FROM old_rows
    UNION
    SELECT id, org_id FROM new_rows
  ) x;
  PERFORM public.pos_try_lock_grant_sources_v1(sources);
  IF EXISTS (
    SELECT 1 FROM old_rows o
    JOIN public.pos_package_grants g
      ON g.org_id = o.org_id AND g.source_ticket_id = o.id
    WHERE NOT EXISTS (
      SELECT 1 FROM new_rows n
      WHERE n.id = o.id AND n.org_id = o.org_id AND n.currency = o.currency
    )
  ) THEN
    RAISE EXCEPTION 'referenced grant source identity and currency are immutable'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_ticket_grant_delete_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE sources jsonb;
BEGIN
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orgId', o.org_id, 'ticketId', o.id::text
    )), '[]'::jsonb
  ) INTO sources FROM old_rows o;
  PERFORM public.pos_try_lock_grant_sources_v1(sources);
  IF EXISTS (
    SELECT 1 FROM old_rows o
    JOIN public.pos_package_grants g
      ON g.org_id = o.org_id AND g.source_ticket_id = o.id
  ) THEN
    RAISE EXCEPTION 'referenced grant source identity and currency are immutable'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pos_ticket_grant_authority_update_v1 ON public.pos_tickets;
DROP TRIGGER IF EXISTS pos_ticket_grant_authority_delete_v1 ON public.pos_tickets;
DROP TRIGGER IF EXISTS pos_ticket_grant_update_guard_v1 ON public.pos_tickets;
CREATE TRIGGER pos_ticket_grant_update_guard_v1 AFTER UPDATE ON public.pos_tickets
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.pos_ticket_grant_update_guard_v1();
DROP TRIGGER IF EXISTS pos_ticket_grant_delete_guard_v1 ON public.pos_tickets;
CREATE TRIGGER pos_ticket_grant_delete_guard_v1 AFTER DELETE ON public.pos_tickets
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
EXECUTE FUNCTION public.pos_ticket_grant_delete_guard_v1();

ALTER TABLE public.pos_payment_plans
  ADD COLUMN operation_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN operation_client_key text;
ALTER TABLE public.pos_payment_plans DROP CONSTRAINT pos_payment_plans_operation_check;
ALTER TABLE public.pos_payment_plans ADD CONSTRAINT pos_payment_plans_operation_check CHECK (
  (operation_id IS NULL AND operation_hash IS NULL AND operation_client_key IS NULL) OR
  (operation_id IS NOT NULL AND operation_hash IS NOT NULL
    AND operation_hash ~ '^[0-9a-f]{64}$' AND created_by IS NOT NULL
    AND ((operation_version = 1 AND operation_client_key IS NULL)
      OR (operation_version = 2 AND operation_client_key ~
        '^(party|contact):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')))
);

REVOKE UPDATE, DELETE ON TABLE public.pos_client_ledger
  FROM PUBLIC, anon, authenticated, app_ledger;
