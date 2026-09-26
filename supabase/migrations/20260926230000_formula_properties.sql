alter table public.app_table_properties
  add column template_key text;
--> statement-breakpoint
alter table public.app_table_properties
  add constraint app_table_properties_template_key_nonempty
  check (template_key is null or length(btrim(template_key)) between 1 and 120);
--> statement-breakpoint
create unique index app_table_properties_template_key_uniq
  on public.app_table_properties(org_id, table_id, template_key)
  where template_key is not null;

-- Formula definitions remain organization-owned rows in app_table_properties.
-- This migration intentionally installs no template for any organization;
-- the guarded opt-in installer performs the separately authorized write.
