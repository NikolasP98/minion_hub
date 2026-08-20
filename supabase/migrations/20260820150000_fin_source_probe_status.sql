-- Durable per-tenant credential probe evidence for finance connectors.
-- Credentials remain encrypted in secret_refs; these columns contain only
-- bounded, non-secret validation metadata.

alter table public.fin_sources
  add column if not exists last_probe_at timestamptz,
  add column if not exists last_probe_status text,
  add column if not exists last_probe_message text;
