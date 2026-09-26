create table public.app_table_properties (
  id uuid not null default gen_random_uuid(),
  org_id text not null,
  table_id text not null check (table_id in ('stock.items','stock.entries','pos.catalog','crm.customers','finances.invoices','finances.purchases','socials.campaigns','team.people')),
  label text not null check (length(btrim(label)) between 1 and 80 and label = btrim(label)),
  description text check (description is null or length(description) <= 500),
  rules jsonb not null check (octet_length(rules::text) <= 65536),
  has_default integer not null default 0 check (has_default in (0,1)),
  default_value jsonb,
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  created_by text not null check (created_by <> ''),
  updated_by text not null check (updated_by <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  check (has_default = 1 or default_value is null)
);
--> statement-breakpoint
create index app_table_properties_org_table_idx on public.app_table_properties(org_id, table_id, archived_at);
--> statement-breakpoint
create unique index app_table_properties_active_label_uniq
  on public.app_table_properties(org_id, table_id, lower(label)) where archived_at is null;
--> statement-breakpoint
create table public.app_table_property_values (
  org_id text not null,
  property_id uuid not null,
  record_id text not null check (length(record_id) between 1 and 500),
  value jsonb not null,
  version integer not null default 1 check (version > 0),
  created_by text not null check (created_by <> ''),
  updated_by text not null check (updated_by <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, property_id, record_id),
  constraint app_table_property_values_property_fk foreign key (org_id, property_id) references public.app_table_properties(org_id, id),
  check (octet_length(value::text) <= 65536)
);
--> statement-breakpoint
create index app_table_property_values_record_idx on public.app_table_property_values(org_id, record_id);
--> statement-breakpoint
grant select, insert, update, delete on public.app_table_properties, public.app_table_property_values to app_ledger;
--> statement-breakpoint
alter table public.app_table_properties enable row level security;
--> statement-breakpoint
alter table public.app_table_properties force row level security;
--> statement-breakpoint
create policy app_table_properties_org_guc on public.app_table_properties for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
alter table public.app_table_property_values enable row level security;
--> statement-breakpoint
alter table public.app_table_property_values force row level security;
--> statement-breakpoint
create policy app_table_property_values_org_guc on public.app_table_property_values for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
