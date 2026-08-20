-- CI-only synthetic reproduction of the prod schema slice that
-- `crm-funnel.concurrent.integration.test.ts` needs to run through the real
-- `withOrgCore` path (role `app_ledger` + `app.current_org_id` GUC), not a
-- mocked one. This is NOT a migration: it is never applied to a real Supabase
-- project, and it must be re-verified against prod if this suite starts
-- failing for no code reason (schema drift risk — see the
-- `hub-supabase-schema-not-reproducible` operator memory note).
--
-- Source for the shape asserted below (spec 2026-08-20-handoff-minion-hub-
-- 3530856808-spec, Slice 0): an operator pulled the live prod RLS/catalog
-- facts for `crm_contacts`/`crm_activities` via `vercel env pull` (minion-hub
-- project) + `psql` against `pg_policies`/`information_schema` (operator
-- memory `sdlc-board-triage-and-phase-gates.md`, "TICK ~13:10Z" entry; dev run
-- `485528fa` carried the resulting DDL). The extracted facts recorded there:
-- both `crm_contacts` and `crm_activities` use the repo's standard `_org_guc`
-- policy convention, RLS is ENABLED and FORCED on both tables, and `org_id`
-- is TEXT (not uuid) on both. That convention — a single TO-less
-- `for all using (org_id = current_setting('app.current_org_id', true))
-- with check (...)` policy plus a separate `grant ... to app_ledger` — is the
-- same one already shipped to prod verbatim in
-- `supabase/migrations/20260717230000_crm_conversation_chunks.sql`
-- (`crm_conversation_chunks_org_guc`), so this fixture reproduces a pattern
-- independently confirmed twice: once by the live prod pull above, once by an
-- already-applied migration using the identical shape. The exact raw
-- `psql` output text itself was not preserved verbatim in the operator
-- handoff — only the extracted facts above were — so the catalog assertions
-- below assert those facts (policy shape, forced RLS, grants), not a
-- character-for-character transcript.
--
-- A TO-less `create policy` always reports `roles = {public}` in
-- `pg_policies`, never `{app_ledger}` — asserting `roles @> '{app_ledger}'`
-- on such a policy can never pass (see operator memory factory note
-- `2026-08-20-0eb02565`, reproduced locally here via `@electric-sql/pglite`
-- before committing this file).
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ledger') then
    create role app_ledger nologin;
  end if;
end
$$;

-- Minimal stand-in for prod's `organizations` table: this suite only reads
-- `id`, so only `id` is reproduced here (the real table's full column set is
-- unknown from source and irrelevant to this suite's assertions — spec §2 AS-IS).
create table organizations (
  id uuid primary key default gen_random_uuid()
);

insert into organizations (id) values ('00000000-0000-0000-0000-000000000001');

-- Structurally matches src/server/db/pg-crm-schema.ts's `crmContacts`.
create table crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  human_id text,
  display_name text,
  profile_id uuid,
  owner_id uuid,
  party_id uuid,
  lifecycle_override text,
  source text not null default 'harvested',
  custom_fields jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_contacts_org_recent_idx on crm_contacts (org_id, updated_at);
create index crm_contacts_profile_idx on crm_contacts (profile_id);
create index crm_contacts_party_idx on crm_contacts (party_id);

-- Structurally matches src/server/db/pg-crm-schema.ts's `crmActivities`.
create table crm_activities (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  contact_id uuid not null references crm_contacts (id) on delete cascade,
  kind text not null,
  body text,
  actor_id uuid,
  data jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index crm_activities_contact_idx on crm_activities (contact_id, occurred_at);
create index crm_activities_org_idx on crm_activities (org_id, occurred_at);

alter table crm_contacts enable row level security;
alter table crm_contacts force row level security;
drop policy if exists crm_contacts_org_guc on crm_contacts;
create policy crm_contacts_org_guc on crm_contacts
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table crm_activities enable row level security;
alter table crm_activities force row level security;
drop policy if exists crm_activities_org_guc on crm_activities;
create policy crm_activities_org_guc on crm_activities
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- app_ledger is the non-bypass role withOrgCore SET LOCAL ROLEs into inside
-- the txn (with-org-core.ts) — needs explicit table grants, same as every
-- other org_guc table.
grant select, insert, update, delete on crm_contacts to app_ledger;
grant select, insert, update, delete on crm_activities to app_ledger;

-- Catalog assertions (DELTA #2, spec §Slice 1): fail loud, not pass empty.
-- A behavioral query alone cannot detect a missing FORCE ROW LEVEL SECURITY,
-- because app_ledger is not the table owner and only FORCE makes RLS apply to
-- the owner too — so this checks the catalog flags directly.
do $$
declare
  bad_rls_count int;
begin
  select count(*) into bad_rls_count
  from pg_class
  where relname in ('crm_contacts', 'crm_activities')
    and (relrowsecurity is not true or relforcerowsecurity is not true);
  if bad_rls_count > 0 then
    raise exception
      'crm-funnel-concurrent fixture: % of crm_contacts/crm_activities missing enabled+forced RLS',
      bad_rls_count;
  end if;
end
$$;

do $$
declare
  rec record;
  expected_qual constant text :=
    '(org_id = current_setting(''app.current_org_id''::text, true))';
  seen_contacts boolean := false;
  seen_activities boolean := false;
begin
  for rec in
    select tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where tablename in ('crm_contacts', 'crm_activities')
  loop
    if rec.permissive is distinct from 'PERMISSIVE'
      or rec.roles is distinct from array['public']::name[]
      or rec.cmd is distinct from 'ALL'
      or rec.qual is distinct from expected_qual
      or rec.with_check is distinct from expected_qual
    then
      raise exception
        'crm-funnel-concurrent fixture: % policy % does not match the Slice-0-verified org_guc shape (permissive=%, roles=%, cmd=%, qual=%, with_check=%)',
        rec.tablename, rec.policyname, rec.permissive, rec.roles, rec.cmd, rec.qual, rec.with_check;
    end if;
    if rec.tablename = 'crm_contacts' then seen_contacts := true; end if;
    if rec.tablename = 'crm_activities' then seen_activities := true; end if;
  end loop;

  if not seen_contacts or not seen_activities then
    raise exception
      'crm-funnel-concurrent fixture: expected one org_guc policy on EACH of crm_contacts and crm_activities (crm_contacts seen=%, crm_activities seen=%)',
      seen_contacts, seen_activities;
  end if;
end
$$;

do $$
declare
  bad_grant_count int;
begin
  select count(*) into bad_grant_count
  from (
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_name in ('crm_contacts', 'crm_activities') and grantee = 'app_ledger'
  ) actual
  right join (
    select t, p
    from unnest(array['crm_contacts', 'crm_activities']) t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
  ) expected on expected.t = actual.table_name and expected.p = actual.privilege_type
  where actual.table_name is null;
  if bad_grant_count > 0 then
    raise exception
      'crm-funnel-concurrent fixture: app_ledger is missing % of the expected select/insert/update/delete grants on crm_contacts/crm_activities',
      bad_grant_count;
  end if;
end
$$;

commit;
