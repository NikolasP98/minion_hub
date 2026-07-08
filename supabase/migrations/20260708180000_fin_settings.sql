-- Per-org finance settings (display currency, IGV tax rate, USD↔PEN exchange
-- rate with auto default + manual override) + make currency non-null PEN across
-- the finance/sales/membership money headers so every stored value carries a
-- currency. FACES is single-currency PEN.

create table if not exists public.fin_settings (
  org_id         text primary key,
  currency       text not null default 'PEN',
  tax_rate       numeric not null default 0.18,   -- IGV as a fraction
  fx_base        text not null default 'USD',
  fx_quote       text not null default 'PEN',
  fx_mode        text not null default 'auto',    -- 'auto' | 'manual'
  fx_manual_rate numeric,
  fx_auto_rate   numeric,
  fx_source      text,
  fx_updated_at  timestamptz,
  updated_at     timestamptz not null default now()
);

-- Org-scoped RLS to match the rest of the finance schema (app_ledger role +
-- app.current_org_id GUC via withOrgCore).
alter table public.fin_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fin_settings' and policyname='fin_settings_org') then
    create policy fin_settings_org on public.fin_settings
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.fin_settings to app_ledger;

-- Backfill: every money header now carries a currency (was nullable, no default).
update public.fin_invoices     set currency = 'PEN' where currency is null;
update public.sales_orders     set currency = 'PEN' where currency is null;
update public.membership_plans set currency = 'PEN' where currency is null;

-- Default new rows to PEN going forward (line/child tables inherit the header's
-- currency; the stock module is implicitly org currency).
alter table public.fin_invoices     alter column currency set default 'PEN';
alter table public.sales_orders     alter column currency set default 'PEN';
alter table public.membership_plans alter column currency set default 'PEN';
