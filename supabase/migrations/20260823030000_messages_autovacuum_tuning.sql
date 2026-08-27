-- Keep the messages visibility map fresh so messages_crm_agg_covering_idx
-- stays index-only. Default autovacuum insert threshold (~20% of the table)
-- let ~38k unvacuumed inserts accumulate, degrading the CRM rank agg from
-- 0.66s back to 26-110s via heap fetches (observed in prod 2026-08-23).
-- Applied to prod manually 2026-08-23; recorded here for replay.
alter table messages set (
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.0,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
