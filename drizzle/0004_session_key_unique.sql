CREATE UNIQUE INDEX IF NOT EXISTS `sessions_uniq_key` ON `sessions` (`tenant_id`,`server_id`,`session_key`);
