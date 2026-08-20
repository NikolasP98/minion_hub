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
-- A repo-wide grep for `app.current_org_id` (2026-08-20 review-fix round)
-- turned up the identical `for all using (...) with check (...)` — no `TO`
-- clause, separate `grant ... to app_ledger` — pattern in every other
-- org_guc migration checked into `supabase/migrations/` (e.g.
-- `20260709133000_email_ledger.sql`, `20260814050000_fin_purchases.sql`,
-- `20260717170000_meta_lead_attribution.sql`), not just the one sibling
-- named above: this is the repo's single established, prod-applied
-- convention, not an isolated guess.
--
-- 5. The exact Postgres catalog shape this DDL produces (role list when no
--    `TO` clause is given, and the canonical deparsed `qual`/`with_check`
--    text) was captured by actually running this fixture's own
--    `CREATE POLICY` statement through a real Postgres engine
--    (`@electric-sql/pglite`, already a repo devDependency) and reading back
--    `pg_policies` — not guessed. Result: `roles = {public}` (Postgres
--    assigns PUBLIC to a policy with no `TO` clause; table access stays
--    scoped to `app_ledger` via the separate `grant` statements below, which
--    is the same shape every migration above uses), and
--    `qual = with_check = (org_id = current_setting('app.current_org_id'::text, true))`.
--
-- TODO(handoff): none of the above is a live query against the *actual*
-- `crm_contacts`/`crm_activities` policies in the provisioned Supabase
-- project — it is still reconstruction from checked-in evidence, confirmed
-- only self-consistent (matches what this exact DDL produces on a real
-- Postgres engine), not verified-equivalent-to-prod. Review round 1
-- (2026-08-20) flagged this as a High-severity stop-ship gap per spec §5 A1:
-- Slice 2 (wiring this fixture into a real CI job) MUST NOT proceed until a
-- human/ops operator with prod (or a verified schema-clone, per
-- hub-local-qa-stack-recipe.md) read access runs the four queries in spec
-- §Slice 0 against the real project and confirms they match what's encoded
-- here. This sandboxed agent has no prod/Supabase credential and no
-- meta-repo checkout in this round either — that gate remains genuinely
-- open, not merely undocumented. If the live queries don't match, this file
-- must be corrected before Slice 2 is trusted as proof.
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
--    table lacks ENABLEd+FORCEd RLS, has other than exactly one policy, or
--    that one policy's role/cmd/predicate/permissive shape isn't an exact
--    match for what this fixture's own DDL is expected to produce.
--
--    Asserts the exact deparsed `qual`/`with_check` text (not a substring
--    pattern match) and the exact policy count and role set — see the
--    provenance note above for how the expected values were captured
--    (running this exact DDL through a real Postgres engine). A regex like
--    `!~ 'org_id'` would accept `true OR org_id = current_setting(...)`,
--    which is a materially different, cross-org-leaking predicate; a
--    role-containment check (`roles @> {app_ledger}`) can never be satisfied
--    by a `TO`-less policy (roles = {public} literally, not one row per
--    grantee reachable via that role) and would make this DO block always
--    raise. An exact policy-count check additionally catches a stray extra
--    permissive policy (e.g. `USING (true)`), which Postgres ORs together
--    with the named org_guc policy — a shape the named-policy check alone
--    can never see.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  priv text;
  rel record;
  pol record;
  pol_count integer;
  expected_predicate constant text :=
    $qual$(org_id = current_setting('app.current_org_id'::text, true))$qual$;
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

    select count(*) into pol_count
      from pg_policies
      where schemaname = 'public' and tablename = tbl;

    if pol_count != 1 then
      raise exception 'fixture assertion failed: % has % pg_policies rows (expected exactly 1 — '
        'an extra policy would silently widen access, since Postgres ORs permissive policies '
        'together)', tbl, pol_count;
    end if;

    select policyname, permissive, roles, cmd, qual, with_check
      into pol
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname = tbl || '_org_guc';

    if not found then
      raise exception 'fixture assertion failed: % has no policy named %_org_guc', tbl, tbl;
    end if;

    if pol.permissive is distinct from 'PERMISSIVE' then
      raise exception 'fixture assertion failed: %_org_guc is % (expected PERMISSIVE — a '
        'RESTRICTIVE policy combines with AND instead of OR and changes the effective access '
        'rule entirely)', tbl, pol.permissive;
    end if;

    -- Exact role-set assertion, not containment: `for all` with no `TO`
    -- clause assigns the policy to PUBLIC — the repo-wide convention for
    -- every org_guc policy checked into supabase/migrations/ (see
    -- provenance note above), not a bug. Table-level access stays scoped to
    -- app_ledger via the separate `grant` statements checked below.
    if pol.roles is distinct from array['public']::name[] then
      raise exception 'fixture assertion failed: %_org_guc roles = % (expected exactly {public} '
        '— no TO clause was specified, so Postgres assigns PUBLIC)', tbl, pol.roles;
    end if;

    if pol.cmd is distinct from 'ALL' then
      raise exception 'fixture assertion failed: %_org_guc cmd is % (expected ALL)', tbl, pol.cmd;
    end if;

    if pol.qual is distinct from expected_predicate then
      raise exception 'fixture assertion failed: %_org_guc USING expression is %, expected %',
        tbl, pol.qual, expected_predicate;
    end if;

    if pol.with_check is distinct from expected_predicate then
      raise exception 'fixture assertion failed: %_org_guc WITH CHECK expression is %, expected %',
        tbl, pol.with_check, expected_predicate;
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
