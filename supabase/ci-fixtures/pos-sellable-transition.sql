-- ============================================================================
-- CI-ONLY schema fixture for `pos.sellables.concurrent.integration.test.ts`.
--
-- THIS IS NOT A MIGRATION. It lives outside `supabase/migrations/` on purpose
-- and must NEVER be applied to a real Supabase project. It is a synthetic,
-- minimal reproduction of the *subset* of production schema that one test file
-- touches: the tables `updateSellable` reads and writes, the `app_ledger` role,
-- and the org-GUC RLS policies `withOrgCore()` relies on.
--
-- PROVENANCE — read this before changing anything. Two classes of table:
--
--   1. REPO-OWNED (copied from the checked-in migration, verbatim shape):
--        stk_items      supabase/migrations/20260702130000_stock.sql
--                       + 20260719230000_stk_items_fin_product_uniq.sql
--                         (the partial unique index this suite exists to prove)
--                       + the later additive columns that
--                         `src/server/db/pg-schema/stock.ts` carries, because
--                         `createItemTx` ends in `.returning()` and Drizzle
--                         selects every column of the model.
--        stk_bins       supabase/migrations/20260702130000_stock.sql
--        stk_consumption
--                       supabase/migrations/20260703160000_stock_consumption.sql
--      For these the RLS policies and grants below are the migrations' own.
--
--   2. RECONSTRUCTED from the Drizzle model, because the table has no `create
--      table` anywhere in this repository (the `hub-supabase-schema-not-
--      reproducible` operator note — these are prod-only tables):
--        fin_products            src/server/db/pg-finance-schema.ts
--        fin_product_components  src/server/db/pg-finance-schema.ts
--        fin_invoice_items       only the two columns the rename guard reads
--
--      Their prod RLS/grant shape was NOT live-extracted and is NOT claimed
--      here: this fixture gives them the uniform `<table>_org_guc` policy every
--      migration in this repo writes, purely so the suite can run through the
--      real `withOrgCore()` (SET LOCAL ROLE app_ledger + app.current_org_id)
--      instead of a bypass path. What the suite proves — that
--      `stk_items_org_fin_product_uniq` admits exactly one linked item under
--      genuinely concurrent transactions, and that a `fin_products_org_code_uniq`
--      violation rolls the item insert back — depends on the UNIQUE INDEXES and
--      on transaction semantics, neither of which is affected by policy text.
--
-- DRIFT IS A KNOWN, ACCEPTED RISK, exactly as for the sibling CRM fixture.
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

-- ── fin_products (RECONSTRUCTED — see provenance note) ──────────────────────
create table if not exists public.fin_products (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  sku        uuid not null default gen_random_uuid(),
  code       text not null,
  name       text not null,
  category   text,
  unit_price numeric,
  active     boolean not null default true,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The constraint the "a failed PATCH leaves no partial mutation" case trips on.
create unique index if not exists fin_products_org_code_uniq
  on public.fin_products (org_id, code);

-- ── fin_product_components (RECONSTRUCTED) ─────────────────────────────────
-- Read by SELLABLE_MERGE_SQL's `is_bundle` exists() sub-select only.
create table if not exists public.fin_product_components (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null,
  bundle_product_id  uuid not null references public.fin_products (id) on delete cascade,
  child_product_id   uuid not null references public.fin_products (id) on delete restrict,
  qty                numeric not null default 1,
  line_no            integer not null default 0,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── fin_invoice_items (RECONSTRUCTED, PARTIAL) ─────────────────────────────
-- `updateSellable`'s rename guard runs exactly one query against this table:
-- `select count(*) from fin_invoice_items where org_id = $1 and code = $2`.
-- Only those two columns are reproduced; a wider guess would be the kind of
-- unverified reconstruction this header exists to flag.
create table if not exists public.fin_invoice_items (
  org_id text not null,
  code   text
);

-- ── stk_items (REPO-OWNED) ─────────────────────────────────────────────────
create table if not exists public.stk_items (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  text not null,
  sku                     uuid not null default gen_random_uuid(),
  code                    text not null,
  name                    text not null,
  uom                     text not null default 'unit',
  item_group              text,
  is_stock_item           boolean not null default true,
  reorder_level           numeric,
  reorder_qty             numeric,
  moq                     numeric,
  default_supplier_party_id uuid,
  consumption_uom         text,
  units_per_stock_uom     numeric,
  subunits_per_stock_uom  numeric,
  diagram_enabled         boolean not null default false,
  unit_svg                text,
  subunit_svg             text,
  valuation_method        text not null default 'moving_avg',
  fin_product_id          uuid,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists stk_items_org_code_uniq
  on public.stk_items (org_id, code);
create index if not exists stk_items_org_idx on public.stk_items (org_id);

-- ★ THE INVARIANT UNDER TEST. Verbatim from
-- supabase/migrations/20260719230000_stk_items_fin_product_uniq.sql.
create unique index if not exists stk_items_org_fin_product_uniq
  on public.stk_items (org_id, fin_product_id)
  where fin_product_id is not null;

-- ── stk_bins (REPO-OWNED) ──────────────────────────────────────────────────
create table if not exists public.stk_bins (
  org_id          text not null,
  item_id         uuid not null,
  warehouse_id    uuid not null,
  qty             numeric not null default 0,
  valuation_rate  numeric not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (org_id, item_id, warehouse_id)
);

-- ── stk_consumption (REPO-OWNED) ───────────────────────────────────────────
create table if not exists public.stk_consumption (
  id              uuid primary key default gen_random_uuid(),
  org_id          text not null,
  fin_product_id  uuid not null,
  item_id         uuid not null references public.stk_items (id) on delete cascade,
  qty_per_unit    numeric not null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists stk_consumption_org_product_item_uniq
  on public.stk_consumption (org_id, fin_product_id, item_id);

-- ── grants + RLS ───────────────────────────────────────────────────────────
-- `app_ledger` is the non-bypass role `withOrgCore` SET LOCAL ROLEs into.
grant select, insert, update, delete on public.fin_products           to app_ledger;
grant select, insert, update, delete on public.fin_product_components to app_ledger;
grant select                         on public.fin_invoice_items      to app_ledger;
grant select, insert, update, delete on public.stk_items              to app_ledger;
grant select, insert, update, delete on public.stk_bins               to app_ledger;
grant select, insert, update, delete on public.stk_consumption        to app_ledger;

alter table public.fin_products           enable row level security;
alter table public.fin_products           force  row level security;
alter table public.fin_product_components enable row level security;
alter table public.fin_product_components force  row level security;
alter table public.fin_invoice_items      enable row level security;
alter table public.fin_invoice_items      force  row level security;
alter table public.stk_items              enable row level security;
alter table public.stk_items              force  row level security;
alter table public.stk_bins               enable row level security;
alter table public.stk_bins               force  row level security;
alter table public.stk_consumption        enable row level security;
alter table public.stk_consumption        force  row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'fin_products', 'fin_product_components', 'fin_invoice_items',
    'stk_items', 'stk_bins', 'stk_consumption'
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public'
                     and tablename = t and policyname = t || '_org_guc') then
      execute format(
        'create policy %I on public.%I for all
           using (org_id = current_setting(''app.current_org_id'', true))
           with check (org_id = current_setting(''app.current_org_id'', true))',
        t || '_org_guc', t);
    end if;
  end loop;
end
$$;

-- ── executable catalog assertions ──────────────────────────────────────────
-- With ON_ERROR_STOP these ARE the fixture's self-check: a container that
-- applied a stale copy, or a fixture edited into a looser shape, fails HERE
-- rather than producing a green run against a schema the suite does not mean.
do $$
begin
  -- The partial unique index, spelled exactly as the migration writes it.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'stk_items_org_fin_product_uniq'
      and indexdef ilike '%unique%(org_id, fin_product_id)%'
      and indexdef ilike '%where (fin_product_id is not null)%'
  ) then
    raise exception 'stk_items_org_fin_product_uniq is missing or is not the partial unique index';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'fin_products_org_code_uniq'
      and indexdef ilike '%unique%(org_id, code)%'
  ) then
    raise exception 'fin_products_org_code_uniq is missing or is not unique on (org_id, code)';
  end if;

  -- RLS must be enabled AND forced on every table the suite writes through
  -- withOrgCore: unforced RLS would silently let the owner connection bypass
  -- the policies and the suite would stop proving it runs under app_ledger.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('fin_products', 'fin_product_components', 'fin_invoice_items',
                        'stk_items', 'stk_bins', 'stk_consumption')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    raise exception 'a fixture table is missing enable/force row level security';
  end if;

  -- `stk_items.uom` NOT NULL DEFAULT 'unit' is what makes a blank uom a
  -- storage-visible fact rather than a null; the uom-normalisation case reads
  -- the stored string back, so the column shape is part of the contract.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stk_items' and column_name = 'uom'
      and is_nullable = 'NO' and column_default = '''unit''::text'
  ) then
    raise exception 'stk_items.uom is not NOT NULL DEFAULT ''unit''';
  end if;
end
$$;
