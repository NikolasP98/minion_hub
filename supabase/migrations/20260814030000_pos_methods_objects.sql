-- Promote pos_settings.methods from string[] to PaymentMethod[] objects.
-- See specs/2026-08-14-pos-payment-methods-config-spec.md.
--
-- Additive no-op at the DB level: `methods` is already `jsonb`, which holds
-- either shape natively — nothing to alter or drop here (memory
-- hub-supabase-schema-not-reproducible: additive-only, drop nothing). The
-- service (pos.service.ts normalizeMethods) is the ONLY place that upgrades a
-- legacy bare string (e.g. 'cash') to the new object form on read, so
-- historical rows keep working without a backfill.
comment on column public.pos_settings.methods is
  'PaymentMethod[] objects ({id,label,enabled,takesTendered,surcharge?,documentDefault?}); legacy string[] rows are upgraded on read by pos.service.ts normalizeMethods().';
