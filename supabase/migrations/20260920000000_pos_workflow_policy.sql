-- Organization-scoped behavior; existing organizations retain both POS flows.
alter table public.pos_settings
  add column if not exists workflow jsonb not null
  default '{"postSaleScheduling":"prompt","appointmentPayment":"any_time"}'::jsonb;
