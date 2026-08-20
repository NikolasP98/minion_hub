-- CI-only synthetic reproduction of the prod schema slice that
-- `crm-funnel.concurrent.integration.test.ts` needs to run through the real
-- `withOrgCore` path (role `app_ledger` + `app.current_org_id` GUC), not a
-- mocked one. This is NOT a migration: it lives outside `supabase/migrations/`,
-- is never applied to a real Supabase project, and must be re-verified against
-- prod if this suite starts failing for no code reason (schema-drift risk — see
-- the `hub-supabase-schema-not-reproducible` operator memory note and spec §5 A2).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SOURCE OF THE SHAPE BELOW (spec 2026-08-20-handoff-minion-hub-3530856808-spec,
-- Slice 0). Every table/column/policy/flag asserted here comes from a LIVE
-- extraction against the provisioned Supabase project, run by the operator on
-- 2026-08-20 (`vercel env pull` on the minion-hub project → `psql` against
-- `pg_policies` / `pg_class` / `information_schema`; the pulled `.env.prod` was
-- deleted afterwards). It is NOT reconstructed from checked-in migrations and
-- NOT inferred from the `_org_guc` naming convention — doing that is the exact
-- failure class this spec exists to close. The extracted values, verbatim as the
-- operator handed them off (PR #154 task brief; method recorded in operator
-- memory `sdlc-board-triage-and-phase-gates.md`, "TICK ~13:10Z"):
--
--   crm_contacts   policy crm_contacts_org_guc   ALL roles={public}
--                  USING (org_id = current_setting('app.current_org_id'::text, true))
--                  WITH CHECK same
--   crm_activities policy crm_activities_org_guc identical shape
--   BOTH tables    relrowsecurity = true AND relforcerowsecurity = true
--   crm_contacts.id        uuid NOT NULL default gen_random_uuid()
--   crm_contacts.org_id    text NOT NULL, no default
--   crm_activities.id      uuid default gen_random_uuid()   [no NOT NULL — the
--                          extraction reports this column WITHOUT the NOT NULL it
--                          reports for crm_contacts.id; the asymmetry is
--                          reproduced literally rather than "corrected", so the
--                          gate cannot prove the suite against a constraint prod
--                          does not have]
--   crm_activities.org_id     text NOT NULL
--   crm_activities.contact_id uuid NOT NULL
--   organizations.id       uuid NOT NULL default gen_random_uuid(),
--                          relrowsecurity = true, relforcerowsecurity = false
--
-- NOT covered by that extraction: `information_schema.role_table_grants` for
-- grantee `app_ledger` (the fourth Slice-0 query went unanswered). See the
-- TODO(handoff) on the grant block below for what is granted instead and why it
-- cannot produce a false green.
--
-- A TO-less `create policy` always reports `roles = {public}` in `pg_policies`,
-- never `{app_ledger}` — asserting `roles @> '{app_ledger}'` on such a policy
-- can never pass (operator memory factory note `2026-08-20-0eb02565`). The
-- extraction above independently confirms prod's policies are TO-less.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ledger') then
    create role app_ledger nologin;
  end if;
end
$$;

-- Stand-in for prod's `organizations`: this suite only reads `id`
-- (`select id::text from organizations limit 1`), and only `id` was extracted,
-- so only `id` is reproduced. No primary key / unique constraint is declared —
-- the extraction records `id` as NOT NULL with a `gen_random_uuid()` default and
-- says nothing about uniqueness, and nothing here needs it.
create table organizations (
  id uuid not null default gen_random_uuid()
);

-- RLS is enabled (not forced) on prod's `organizations`. No policy was
-- extracted, so none is defined here: that is strictly MORE restrictive than
-- prod for non-owner roles, and the suite reads this table only on its
-- superuser `owner` connection, which bypasses RLS.
alter table organizations enable row level security;

insert into organizations (id) values ('00000000-0000-0000-0000-000000000001');

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

-- `id` is deliberately NOT a primary key here: a primary key implies NOT NULL,
-- and the extraction reports `crm_activities.id` without one (unlike
-- `crm_contacts.id`). The FK below is the one constraint the spec names for this
-- table (§3 Slice 1), and it needs uniqueness on `crm_contacts.id`, not here.
create table crm_activities (
  id uuid default gen_random_uuid(),
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
create policy crm_contacts_org_guc on crm_contacts
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

alter table crm_activities enable row level security;
alter table crm_activities force row level security;
create policy crm_activities_org_guc on crm_activities
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- TODO(handoff): prod's real grant set for `app_ledger` on these two tables is
-- the one Slice-0 query the operator's live extraction did not return
-- (`select grantee, table_name, privilege_type from
-- information_schema.role_table_grants where table_name in ('crm_contacts',
-- 'crm_activities') and grantee = 'app_ledger'`), so this fixture does NOT claim
-- grant parity with prod. Instead it grants the minimum this gate exercises,
-- enumerated from shipped source: SELECT + UPDATE on crm_contacts
-- (`crm-contacts.service.ts:1289-1294` `.for('update')`, `:791-800`
-- `setContactCustomField`'s UPDATE … RETURNING), INSERT on crm_activities
-- (`:1324-1337`), plus INSERT on crm_contacts and SELECT on crm_activities for
-- the cross-org negative control the spec mandates (§3 Slice 1 DoD). DELETE is
-- deliberately not granted. A grant NARROWER than prod's cannot make the gate
-- pass where prod would fail — a missing privilege raises `permission denied`,
-- it cannot silently succeed — and prod must grant at least these, because the
-- shipped `setFunnelStage` path runs through them in production today. Resolve
-- by re-running that query against prod and asserting its literal rows here.
-- Pointer: docs/superpowers/plans/2026-08-20-crm-funnel-concurrent-ci-gate-slice0-blocked.md
-- ("Slice 0 query coverage"), spec 2026-08-20-handoff-minion-hub-3530856808-spec §3 Slice 0.
grant select, insert, update on crm_contacts to app_ledger;
grant select, insert, update on crm_activities to app_ledger;

-- ── Catalog assertions (spec §Slice 1, DELTA #2): fail loud, not pass empty ───
-- These make the Slice-0 extraction executable. Applying this file must RAISE if
-- the resulting schema differs from the recorded prod shape in any asserted way,
-- so a hand-edit that silently weakens the fixture breaks the CI job instead of
-- quietly widening what the concurrency gate certifies.

-- 1. RLS catalog flags. A behavioral query alone cannot detect a missing FORCE
--    ROW LEVEL SECURITY, because `app_ledger` is not the table owner and only
--    FORCE makes RLS apply to the owner too — so check the flags directly.
do $$
declare
  actual text[];
  expected constant text[] := array[
    'crm_activities|true|true',
    'crm_contacts|true|true',
    'organizations|true|false'
  ];
begin
  select coalesce(array_agg(r order by r), array[]::text[]) into actual
  from (
    select concat_ws('|', c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text) as r
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('crm_contacts', 'crm_activities', 'organizations')
  ) s;
  if actual is distinct from expected then
    raise exception
      'crm-funnel-concurrent fixture: RLS catalog flags do not match the Slice-0 extraction. expected=% actual=%',
      expected, actual;
  end if;
end
$$;

-- 2. The EXACT policy set — name, cardinality and predicate text. An extra,
--    missing, renamed or reshaped policy must fail; "at least one row of roughly
--    the right shape" is not the contract.
do $$
declare
  actual text[];
  expected constant text[] := array[
    'public|crm_activities|crm_activities_org_guc|PERMISSIVE|{public}|ALL|(org_id = current_setting(''app.current_org_id''::text, true))|(org_id = current_setting(''app.current_org_id''::text, true))',
    'public|crm_contacts|crm_contacts_org_guc|PERMISSIVE|{public}|ALL|(org_id = current_setting(''app.current_org_id''::text, true))|(org_id = current_setting(''app.current_org_id''::text, true))'
  ];
begin
  select coalesce(array_agg(r order by r), array[]::text[]) into actual
  from (
    select concat_ws(
             '|', schemaname, tablename, policyname, permissive, roles::text, cmd,
             coalesce(qual, '<null>'), coalesce(with_check, '<null>')
           ) as r
    from pg_policies
    where schemaname = 'public' and tablename in ('crm_contacts', 'crm_activities')
  ) s;
  if actual is distinct from expected then
    raise exception
      'crm-funnel-concurrent fixture: pg_policies does not match the Slice-0 extraction exactly (missing, extra or reshaped policy). expected=% actual=%',
      expected, actual;
  end if;
end
$$;

-- 3. Column type + nullability for every column the extraction recorded,
--    including the crm_contacts.id / crm_activities.id NOT NULL asymmetry.
do $$
declare
  actual text[];
  expected constant text[] := array[
    'crm_activities|contact_id|uuid|NO',
    'crm_activities|id|uuid|YES',
    'crm_activities|org_id|text|NO',
    'crm_contacts|id|uuid|NO',
    'crm_contacts|org_id|text|NO',
    'organizations|id|uuid|NO'
  ];
begin
  select coalesce(array_agg(r order by r), array[]::text[]) into actual
  from (
    select concat_ws('|', table_name, column_name, udt_name, is_nullable) as r
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'organizations' and column_name = 'id')
        or (table_name = 'crm_contacts' and column_name in ('id', 'org_id'))
        or (table_name = 'crm_activities' and column_name in ('id', 'org_id', 'contact_id'))
      )
  ) s;
  if actual is distinct from expected then
    raise exception
      'crm-funnel-concurrent fixture: column type/nullability does not match the Slice-0 extraction. expected=% actual=%',
      expected, actual;
  end if;
end
$$;

-- 4. Column defaults, for the four columns whose default the extraction states
--    (the two crm_activities columns above are asserted on type/nullability only
--    — their defaults were not extracted, so nothing is claimed about them).
do $$
declare
  actual text[];
  expected constant text[] := array[
    'crm_activities|id|gen_random_uuid()',
    'crm_contacts|id|gen_random_uuid()',
    'crm_contacts|org_id|<null>',
    'organizations|id|gen_random_uuid()'
  ];
begin
  select coalesce(array_agg(r order by r), array[]::text[]) into actual
  from (
    select concat_ws('|', table_name, column_name, coalesce(column_default, '<null>')) as r
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'organizations' and column_name = 'id')
        or (table_name = 'crm_contacts' and column_name in ('id', 'org_id'))
        or (table_name = 'crm_activities' and column_name = 'id')
      )
  ) s;
  if actual is distinct from expected then
    raise exception
      'crm-funnel-concurrent fixture: column defaults do not match the Slice-0 extraction. expected=% actual=%',
      expected, actual;
  end if;
end
$$;

-- 5. The app_ledger grant set is exactly what the block above grants — no more.
--    Exact match in BOTH directions, so a later edit that widens the fixture's
--    grants (and with them what this gate certifies) trips here.
do $$
declare
  actual text[];
  expected constant text[] := array[
    'crm_activities|INSERT',
    'crm_activities|SELECT',
    'crm_activities|UPDATE',
    'crm_contacts|INSERT',
    'crm_contacts|SELECT',
    'crm_contacts|UPDATE'
  ];
begin
  select coalesce(array_agg(r order by r), array[]::text[]) into actual
  from (
    select distinct concat_ws('|', table_name, privilege_type) as r
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'app_ledger'
      and table_name in ('crm_contacts', 'crm_activities')
  ) s;
  if actual is distinct from expected then
    raise exception
      'crm-funnel-concurrent fixture: app_ledger grants are not exactly the minimum this gate needs. expected=% actual=%',
      expected, actual;
  end if;
end
$$;

commit;
