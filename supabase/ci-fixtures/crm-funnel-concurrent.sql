-- ============================================================================
-- CI-ONLY schema fixture for `crm-funnel.concurrent.integration.test.ts`.
--
-- THIS IS NOT A MIGRATION. It lives outside `supabase/migrations/` on purpose
-- and must NEVER be applied to a real Supabase project. It is a synthetic,
-- minimal reproduction of the *subset* of production schema that one test file
-- touches: `organizations.id`, `crm_contacts`, `crm_activities`, the
-- `app_ledger` role, and the org-GUC RLS policies `withOrgCore()` relies on.
--
-- SOURCE OF THE SHAPE BELOW — read this before changing anything.
--   The RLS policy text, the `relrowsecurity` / `relforcerowsecurity` flags and
--   the `id` / `org_id` / `contact_id` column definitions asserted here were
--   LIVE-EXTRACTED on 2026-08-20 from the provisioned Supabase project by
--   querying `pg_policies`, `pg_class` and `information_schema.columns`
--   directly. They were deliberately NOT reconstructed from the checked-in
--   migrations: no `create table crm_contacts` / `crm_activities` and no
--   `*_org_guc` policy for either table exists anywhere in this repository
--   (see the `hub-supabase-schema-not-reproducible` operator note), so a
--   migration-derived fixture would have been a guess dressed up as a fact.
--   Extraction results, verbatim:
--     crm_contacts   policy `crm_contacts_org_guc`   ALL, roles={public},
--                    USING/WITH CHECK
--                    (org_id = current_setting('app.current_org_id'::text, true))
--     crm_activities policy `crm_activities_org_guc` — identical shape
--     both tables:   relrowsecurity=true AND relforcerowsecurity=true
--     crm_contacts.id      uuid NOT NULL default gen_random_uuid()
--     crm_contacts.org_id  text NOT NULL, no default
--     crm_activities.id    uuid default gen_random_uuid()
--     crm_activities.org_id     text NOT NULL
--     crm_activities.contact_id uuid NOT NULL
--     organizations.id     uuid NOT NULL default gen_random_uuid(),
--                          relrowsecurity=true, relforcerowsecurity=false
--
-- The remaining (non-key) columns mirror `src/server/db/pg-crm-schema.ts`,
-- which owns the table shape in Drizzle even though it does not own roles or
-- policies.
--
-- DRIFT IS A KNOWN, ACCEPTED RISK. This is a point-in-time snapshot; nothing
-- re-checks it against prod on a schedule. If the concurrency suite starts
-- failing with no corresponding code change, re-run the extraction queries
-- above against prod before touching the test — the fixture, not the test, is
-- the likely liar.
-- ============================================================================

-- `create role if not exists` is not valid PostgreSQL; this is the idempotent
-- equivalent, so re-applying the fixture to a warm container is safe.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ledger') then
    create role app_ledger nologin;
  end if;
end
$$;

grant usage on schema public to app_ledger;

-- ── organizations ───────────────────────────────────────────────────────────
-- Only `id` is reproduced. The suite's single touch on this table is
-- `select id::text from organizations limit 1` over the owner (superuser)
-- connection, and `id` is the only column the Slice-0 extraction covered — a
-- wider guess here would be exactly the unverified reconstruction this fixture
-- exists to avoid. RLS is enabled (matching the extracted relrowsecurity=true)
-- but NOT forced (matching relforcerowsecurity=false). Prod's `organizations`
-- policies were not part of the extraction and are deliberately not reproduced
-- or asserted: the suite never reads this table under `app_ledger`, so no
-- policy is needed for it to behave as prod does for this test's purposes.
create table if not exists public.organizations (
  id uuid not null default gen_random_uuid() primary key
);

alter table public.organizations enable row level security;

-- Deterministic seed row: the suite picks an org with `limit 1`, so the org id
-- it writes under must not vary between runs.
insert into public.organizations (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ── crm_contacts ────────────────────────────────────────────────────────────
create table if not exists public.crm_contacts (
  id uuid not null default gen_random_uuid() primary key,
  org_id text not null,
  human_id text,
  display_name text,
  profile_id uuid,
  owner_id uuid,
  party_id uuid,
  lifecycle_override text,
  source text not null default 'harvested',
  custom_fields jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_org_recent_idx
  on public.crm_contacts (org_id, updated_at);
create index if not exists crm_contacts_profile_idx on public.crm_contacts (profile_id);
create index if not exists crm_contacts_party_idx on public.crm_contacts (party_id);

-- ── crm_activities ──────────────────────────────────────────────────────────
-- `id` is deliberately NOT declared `primary key` (and so not `not null`).
-- The extraction records `crm_contacts.id` as `uuid NOT NULL default
-- gen_random_uuid()` but `crm_activities.id` as `uuid default
-- gen_random_uuid()` with no NOT NULL — an asymmetry that is only worth
-- recording if it is real, so it is reproduced here rather than quietly
-- "corrected". A `primary key` implicitly adds NOT NULL (plus a unique index)
-- and would prove the suite against a stricter contract than production has,
-- which is exactly the prod-parity gap this fixture exists to close. Nothing in
-- the suite needs it: every insert lets the default generate the id, and no
-- query joins, upserts or `on conflict`s on `crm_activities.id`. Re-add it only
-- if a fresh live catalog extraction shows prod carries it.
create table if not exists public.crm_activities (
  id uuid default gen_random_uuid(),
  org_id text not null,
  -- The FK/cascade is convention-derived (`pg-crm-schema.ts`), NOT from the
  -- extraction, which covered column definitions only. It is kept because the
  -- suite cleans up by deleting its contact row and relies on the cascade; the
  -- extracted part (`contact_id uuid NOT NULL`) is what the assertions check.
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  kind text not null,
  body text,
  actor_id uuid,
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists crm_activities_contact_idx
  on public.crm_activities (contact_id, occurred_at);
create index if not exists crm_activities_org_idx
  on public.crm_activities (org_id, occurred_at);

-- ── RLS (the whole point of this fixture) ───────────────────────────────────
-- Reproduced literally from the extraction. Note there is NO `to app_ledger`
-- clause: prod's policies carry `roles={public}`, which is what a `for all`
-- policy without a `TO` clause produces. Adding `TO app_ledger` here would
-- diverge from prod AND would make the catalog assertion below unsatisfiable.
alter table public.crm_contacts enable row level security;
alter table public.crm_contacts force row level security;
drop policy if exists crm_contacts_org_guc on public.crm_contacts;
create policy crm_contacts_org_guc on public.crm_contacts
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table public.crm_activities enable row level security;
alter table public.crm_activities force row level security;
drop policy if exists crm_activities_org_guc on public.crm_activities;
create policy crm_activities_org_guc on public.crm_activities
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- `app_ledger` is the non-bypass role `withOrgCore()` does `set local role`
-- into, so it needs explicit table grants — policies alone grant nothing.
-- Grant SHAPE (unlike the policy text above) is NOT from the Slice-0
-- extraction, which did not cover `role_table_grants`: it follows this repo's
-- uniform `*_org_guc` migration convention, e.g.
-- `supabase/migrations/20260717230000_crm_conversation_chunks.sql:60`.
--
-- TODO(handoff): app_ledger's `information_schema.role_table_grants` for
-- crm_contacts/crm_activities were never extracted from production (spec
-- 2026-08-20-handoff-minion-hub-3530856808-spec §3 Slice 0, 3rd query) — the
-- four DML grants below are convention-derived, not verified, which is a
-- stop-ship gap per that spec's §3/§5 A1. A human/ops operator (or a scoped
-- read-only credential) must run `select grantee, table_name, privilege_type
-- from information_schema.role_table_grants where table_name in
-- ('crm_contacts','crm_activities') and grantee = 'app_ledger'` against prod
-- and this fixture updated to match exactly before A1 is resolved — see
-- docs/superpowers/plans/2026-08-20-crm-funnel-concurrent-ci-gate-slice0-blocked.md
-- "A1 (human gate)".
grant select, insert, update, delete on public.crm_contacts to app_ledger;
grant select, insert, update, delete on public.crm_activities to app_ledger;

-- ── Executable catalog assertions ───────────────────────────────────────────
-- Applying this fixture must FAIL LOUDLY if the objects it just created do not
-- match the extracted prod snapshot. A behavioural check alone cannot detect a
-- missing `force row level security` (the suite's owner connection is a
-- superuser and bypasses RLS either way), which is why the catalog is asserted
-- directly rather than left to review.
do $$
declare
  -- `pg_get_expr` deparse of the extracted predicate, identical for USING and
  -- WITH CHECK on both tables.
  expected_expr constant text :=
    '(org_id = current_setting(''app.current_org_id''::text, true))';
  tbl text;
  flags record;
  pol record;
  policy_count int;
begin
  foreach tbl in array array['crm_contacts', 'crm_activities'] loop
    select c.relrowsecurity, c.relforcerowsecurity
      into flags
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = tbl;
    if not found then
      raise exception 'ci-fixture: table public.% was not created', tbl;
    end if;
    if not flags.relrowsecurity then
      raise exception 'ci-fixture: %: relrowsecurity=false, prod snapshot says true', tbl;
    end if;
    if not flags.relforcerowsecurity then
      raise exception 'ci-fixture: %: relforcerowsecurity=false, prod snapshot says true', tbl;
    end if;

    select count(*) into policy_count
      from pg_policies where schemaname = 'public' and tablename = tbl;
    if policy_count <> 1 then
      raise exception 'ci-fixture: % has % policies, prod snapshot has exactly 1', tbl, policy_count;
    end if;

    select * into pol
      from pg_policies where schemaname = 'public' and tablename = tbl;
    if pol.policyname <> tbl || '_org_guc' then
      raise exception 'ci-fixture: %: policy is named %, expected %_org_guc',
        tbl, pol.policyname, tbl;
    end if;
    if pol.permissive <> 'PERMISSIVE' then
      raise exception 'ci-fixture: %: policy is %, prod snapshot says PERMISSIVE', tbl, pol.permissive;
    end if;
    if pol.roles::text <> '{public}' then
      raise exception 'ci-fixture: %: policy roles are %, prod snapshot says {public}',
        tbl, pol.roles::text;
    end if;
    if pol.cmd <> 'ALL' then
      raise exception 'ci-fixture: %: policy cmd is %, prod snapshot says ALL', tbl, pol.cmd;
    end if;
    if pol.qual is distinct from expected_expr then
      raise exception 'ci-fixture: %: policy USING is %, prod snapshot is %',
        tbl, coalesce(pol.qual, '<null>'), expected_expr;
    end if;
    if pol.with_check is distinct from expected_expr then
      raise exception 'ci-fixture: %: policy WITH CHECK is %, prod snapshot is %',
        tbl, coalesce(pol.with_check, '<null>'), expected_expr;
    end if;

    -- Convention-derived (see the grant block above), asserted so a typo in a
    -- grant surfaces here instead of as an opaque "permission denied" mid-test.
    if not has_table_privilege('app_ledger', 'public.' || tbl, 'select')
       or not has_table_privilege('app_ledger', 'public.' || tbl, 'insert')
       or not has_table_privilege('app_ledger', 'public.' || tbl, 'update')
       or not has_table_privilege('app_ledger', 'public.' || tbl, 'delete') then
      raise exception 'ci-fixture: app_ledger is missing select/insert/update/delete on %', tbl;
    end if;
  end loop;

  if not exists (select 1 from public.organizations
                  where id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'ci-fixture: deterministic organizations seed row is missing';
  end if;
end
$$;

-- ── Executable column-shape assertions ──────────────────────────────────────
-- The block above proves the RLS wiring; this one proves the columns the
-- extraction actually recorded still match, one row per extracted fact. It is
-- what keeps the asymmetry between `crm_contacts.id` (NOT NULL) and
-- `crm_activities.id` (nullable) honest: re-adding a `primary key`, a stray
-- `not null`, or a changed default to either table now fails on apply instead
-- of silently gating the suite on a schema contract production does not have.
-- Only the columns Slice 0 extracted are listed — asserting an unextracted
-- column would be reconstruction, which is the thing this fixture refuses.
do $$
declare
  bad record;
begin
  for bad in
    with extracted(tbl, col, data_type, is_nullable, col_default) as (
      values
        ('crm_contacts'::text,   'id'::text,         'uuid'::text, 'NO'::text,  'gen_random_uuid()'::text),
        ('crm_contacts',         'org_id',           'text',       'NO',        null),
        ('crm_activities',       'id',               'uuid',       'YES',       'gen_random_uuid()'),
        ('crm_activities',       'org_id',           'text',       'NO',        null),
        ('crm_activities',       'contact_id',       'uuid',       'NO',        null),
        ('organizations',        'id',               'uuid',       'NO',        'gen_random_uuid()')
    )
    select e.tbl, e.col,
           e.data_type   as want_type,
           e.is_nullable as want_nullable,
           e.col_default as want_default,
           c.data_type      as got_type,
           c.is_nullable    as got_nullable,
           c.column_default as got_default
      from extracted e
      left join information_schema.columns c
        on c.table_schema = 'public'
       and c.table_name   = e.tbl
       and c.column_name  = e.col
     where c.column_name is null
        or c.data_type      is distinct from e.data_type
        or c.is_nullable    is distinct from e.is_nullable
        or c.column_default is distinct from e.col_default
  loop
    raise exception
      'ci-fixture: %.% is (type=%, nullable=%, default=%), prod extraction says (type=%, nullable=%, default=%)',
      bad.tbl, bad.col,
      coalesce(bad.got_type, '<column missing>'),
      coalesce(bad.got_nullable, '<column missing>'),
      coalesce(bad.got_default, '<none>'),
      bad.want_type, bad.want_nullable, coalesce(bad.want_default, '<none>');
  end loop;
end
$$;
