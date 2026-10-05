CREATE INDEX IF NOT EXISTS `idx_unified_events_tenant_server_time`
ON `unified_events` (`tenant_id`,`server_id`,`occurred_at`);
