-- Custom columns on appointments (owner ask 2026-10-02): `scheduling.bookings`
-- joined the custom-property table registry in app code (hub #428), but the
-- DB-level allow-list on app_table_properties.table_id (inline CHECK from
-- 20260926180000_custom_table_properties.sql) still rejected it — every
-- "Manage custom columns" save from the calendar failed with a 500.
-- Same list as `CUSTOM_PROPERTY_TABLE_IDS` in src/lib/tables/custom-properties.ts.
alter table app_table_properties
  drop constraint if exists app_table_properties_table_id_check;
alter table app_table_properties
  add constraint app_table_properties_table_id_check
  check (table_id in (
    'stock.items',
    'stock.entries',
    'pos.catalog',
    'crm.customers',
    'finances.invoices',
    'finances.purchases',
    'socials.campaigns',
    'team.people',
    'scheduling.bookings'
  ));
