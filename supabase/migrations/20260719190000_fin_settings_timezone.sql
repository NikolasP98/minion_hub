-- Business timezone for finance reporting.
--
-- A calendar "day" is a LOCAL concept. Dashboards compared a Lima (UTC-5)
-- business against UTC day boundaries, which cuts its day at 19:00 and rolls
-- evening sales into the next day (2026-06-01 reported 4 sales instead of 7).
-- The window is now resolved to absolute instants in this zone before querying,
-- so `issued_at` comparisons stay sargable on (org_id, issued_at).
--
-- Additive with a default: existing rows keep working, no backfill needed.
alter table fin_settings
  add column if not exists timezone text not null default 'America/Lima';
