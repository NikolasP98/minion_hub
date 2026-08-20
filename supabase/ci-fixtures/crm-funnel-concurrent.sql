-- CI-only synthetic schema for crm-funnel.concurrent.integration.test.ts.
--
-- ============================================================================
-- THIS IS NOT A MIGRATION. It is never applied to a real Supabase project —
-- only to a throwaway `postgres:15` service container inside the dedicated
-- CI job that runs this one integration file (spec
-- 2026-08-20-handoff-minion-hub-3530856808-spec, Slice 1). It lives outside
-- `supabase/migrations/` on purpose so it can never be mistaken for, or
-- accidentally applied as, a real schema change.
--
-- Why this suite needs its own fixture (unlike its self-seeding siblings
-- crm-contacts.sql.integration.test.ts / crm-funnel-parity.sql.integration.test.ts,
-- which mock `withOrgCore` and bypass RLS): this suite deliberately runs
-- through the REAL `withOrgCore` path (src/server/db/with-org-core.ts) —
-- `SET LOCAL ROLE app_ledger` + the `app.current_org_id` GUC — so its value
-- is proving the fix under actual RLS, not a mocked one. Reproducing that
-- here means reproducing the real `organizations`/`crm_contacts`/
-- `crm_activities` shape and RLS, not a bypass.
--
-- Provenance (Slice 0 recon, this PR — see PR description for the full
-- writeup) — NOT a live query against the provisioned Supabase project. This
-- sandboxed dev agent had no prod/Supabase credential and no meta-repo
-- checkout (§A1 of the spec: that recon step may need a human/ops action).
-- What follows was instead reconstructed from evidence already checked into
-- this exact repo at commit 5e77bbe7a (hub master, unmoved since the spec's
-- own verification):
--   1. `src/server/db/pg-crm-schema.ts` — Drizzle OWNS the crm_contacts /
--      crm_activities column shape (types, defaults, nullability, indexes)
--      even though it doesn't own roles/policies (its own header comment
--      says so). That part is exact, not inferred.
--   2. `src/server/db/with-org-core.ts` docstring states the canonical
--      predicate literally: "the per-table `<table>_org_guc` policies
--      (`tenant_id::text = current_setting('app.current_org_id', true)`)
--      take over".
--   3. `supabase/migrations/20260717230000_crm_conversation_chunks.sql` — a
--      CHECKED-IN, already-applied-to-prod migration for a sibling table in
--      the SAME crm module (org_id text, same withOrgCore contract), whose
--      own header comment says it mirrors "same org_guc RLS (role app_ledger
--      + app.current_org_id GUC, see with-org-core.ts)". Its policy body is
--      reproduced verbatim below, retargeted at crm_contacts/crm_activities:
--        for all using (org_id = current_setting('app.current_org_id', true))
--        with check (org_id = current_setting('app.current_org_id', true))
--      one policy per table, granted to app_ledger for
--      select/insert/update/delete, with RLS both ENABLEd and FORCEd.
--   4. `supabase/migrations/20260702130000_stock.sql` (and every other
--      `id uuid` primary key in this repo's migrations) uses the single
--      convention `id uuid primary key default gen_random_uuid()`; no
--      migration ever defines `organizations` itself (confirmed: zero
--      `pgTable('organizations'` hits in src/, zero `create table
--      organizations` hits in supabase/migrations/), but
--      `supabase/migrations/20260611003100_org_areas.sql:19` FK-references
--      it as `organization_id uuid not null references
--      public.organizations (id)`, confirming `organizations.id` is `uuid`
--      (matching the test's own `select id::text from organizations limit 1`
--      cast, which only makes sense if the source column isn't already text).
--
-- This is strong, converging, checked-in evidence — not a bare "_org_guc
-- naming-convention guess" — but it is still reconstruction, not a live
-- `pg_policies`/`information_schema` read against the provisioned project.
-- TODO(handoff): before trusting Slice 2's CI job as the spec's DoD requires
-- ("verified equivalent to prod"), a human/ops operator with prod (or a
-- verified schema-clone, per hub-local-qa-stack-recipe.md) read access
-- should run the four queries in spec §Slice 0 against the real project and
-- confirm they match what's encoded here — see spec A1. If they don't
-- match, this file must be corrected before Slice 2 is trusted as proof.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. app_ledger role — the non-bypass role withOrgCore SETs LOCAL ROLE into.
--    `CREATE ROLE IF NOT EXISTS` is not valid PostgreSQL syntax, hence the
--    existence check. NOLOGIN: this role is only ever reached via SET ROLE
--    from the superuser connection the app uses, never a direct login.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ledger') then
    create role app_ledger nologin;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. organizations — minimal shape this suite touches: `select id::text
--    from organizations limit 1`. No Drizzle definition exists anywhere in
--    the repo (§ AS-IS); only `id` is needed here, deterministic so the
--    fixture is reproducible run to run.
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid()
);

insert into public.organizations (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. crm_contacts / crm_activities — structurally matching
--    src/server/db/pg-crm-schema.ts exactly (defaults, nullability, indexes,
--    FK). No FK to organizations.id: pg-crm-schema.ts's org_id columns are
--    plain `text('org_id').notNull()`, never `.references()`.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contacts (
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

create index if not exists crm_contacts_org_recent_idx
  on public.crm_contacts (org_id, updated_at);
create index if not exists crm_contacts_profile_idx
  on public.crm_contacts (profile_id);
create index if not exists crm_contacts_party_idx
  on public.crm_contacts (party_id);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  kind text not null,
  body text,
  actor_id uuid,
  data jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists crm_activities_contact_idx
  on public.crm_activities (contact_id, occurred_at);
create index if not exists crm_activities_org_idx
  on public.crm_activities (org_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 4. RLS — ENABLE + FORCE (forced is required: app_ledger is not the table
--    owner, but FORCE makes RLS apply even to a role that IS the owner —
--    without it a table-owner role would silently bypass the policy, which
--    is exactly the class of gap the catalog assertion below exists to
--    catch per spec invariant "a broken fixture must fail loud, not pass
--    empty").
-- ---------------------------------------------------------------------------
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

grant select, insert, update, delete on public.crm_contacts to app_ledger;
grant select, insert, update, delete on public.crm_activities to app_ledger;

-- ---------------------------------------------------------------------------
-- 5. Catalog assertions — executable, not a review comment (spec invariant:
--    "a broken fixture must fail loud, not pass empty"). Raises if either
--    table lacks ENABLEd+FORCEd RLS, or lacks an app_ledger-granted policy
--    referencing org_id + the app.current_org_id GUC.
--
--    Deliberately pattern-matches the policy predicate (org_id / GUC name /
--    current_setting present) rather than asserting exact deparsed `qual`/
--    `with_check` text: Postgres's ruleutils pretty-printer is free to
--    reformat stored expressions (e.g. explicit casts on string literals),
--    and this fixture was authored without a live Postgres instance to
--    confirm the exact deparse form against (see provenance note above).
--    What actually closes the "app_ledger isn't the table owner so a
--    behavioral check alone can't detect a missing FORCE" gap is the
--    boolean relforcerowsecurity check, which IS asserted exactly.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  priv text;
  rel record;
  pol record;
begin
  foreach tbl in array array['crm_contacts', 'crm_activities']
  loop
    -- to_regclass (unlike a bare ::regclass cast) returns NULL instead of
    -- raising when the relation is missing, so the existence check below is
    -- actually reachable.
    select relrowsecurity, relforcerowsecurity
      into rel
      from pg_class
      where oid = to_regclass('public.' || tbl);

    if not found or rel.relrowsecurity is null then
      raise exception 'fixture assertion failed: table % does not exist', tbl;
    end if;

    if not rel.relrowsecurity then
      raise exception 'fixture assertion failed: % does not have RLS enabled', tbl;
    end if;

    if not rel.relforcerowsecurity then
      raise exception 'fixture assertion failed: % does not have RLS forced '
        '(app_ledger is not the table owner, so a behavioral check alone '
        'would not detect this)', tbl;
    end if;

    select roles, cmd, qual, with_check
      into pol
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_org_guc';

    if not found then
      raise exception 'fixture assertion failed: % has no policy named %_org_guc', tbl, tbl;
    end if;

    if not (pol.roles @> array['app_ledger']::name[]) then
      raise exception 'fixture assertion failed: %_org_guc does not apply to app_ledger (roles=%)',
        tbl, pol.roles;
    end if;

    if pol.cmd is distinct from 'ALL' then
      raise exception 'fixture assertion failed: %_org_guc cmd is % (expected ALL)', tbl, pol.cmd;
    end if;

    if pol.qual is null
       or pol.qual !~ 'org_id'
       or pol.qual !~ 'current_setting'
       or pol.qual !~ 'app\.current_org_id' then
      raise exception 'fixture assertion failed: %_org_guc USING expression does not reference '
        'org_id + the app.current_org_id GUC (got: %)', tbl, pol.qual;
    end if;

    if pol.with_check is null
       or pol.with_check !~ 'org_id'
       or pol.with_check !~ 'current_setting'
       or pol.with_check !~ 'app\.current_org_id' then
      raise exception 'fixture assertion failed: %_org_guc WITH CHECK expression does not '
        'reference org_id + the app.current_org_id GUC (got: %)', tbl, pol.with_check;
    end if;

    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    loop
      if not has_table_privilege('app_ledger', ('public.' || tbl)::regclass, priv) then
        raise exception 'fixture assertion failed: app_ledger is missing % on %', priv, tbl;
      end if;
    end loop;
  end loop;

  raise notice 'crm-funnel-concurrent fixture: RLS catalog assertions passed for crm_contacts and crm_activities';
end
$$;
