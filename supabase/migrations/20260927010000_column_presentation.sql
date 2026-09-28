alter table public.app_table_properties
  add column if not exists presentation jsonb;
