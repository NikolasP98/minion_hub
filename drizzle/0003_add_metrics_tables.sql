CREATE TABLE `agent_activity_bins` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`bin_ts` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_bins_unique` ON `agent_activity_bins` (`server_id`,`agent_id`,`bin_ts`);--> statement-breakpoint
CREATE INDEX `idx_activity_bins_lookup` ON `agent_activity_bins` (`server_id`,`agent_id`,`bin_ts`);--> statement-breakpoint
CREATE TABLE `config_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`config_json` text NOT NULL,
	`config_hash` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_config_snapshots_server` ON `config_snapshots` (`server_id`);--> statement-breakpoint
CREATE TABLE `credential_health_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`captured_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cred_health_server_time` ON `credential_health_snapshots` (`server_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_cred_health_tenant` ON `credential_health_snapshots` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `gateway_heartbeats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`uptime_ms` integer NOT NULL,
	`active_sessions` integer NOT NULL,
	`active_agents` integer NOT NULL,
	`memory_rss_mb` real,
	`credential_summary_json` text,
	`channel_status_json` text,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gw_heartbeats_server_time` ON `gateway_heartbeats` (`server_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_gw_heartbeats_tenant` ON `gateway_heartbeats` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `skill_execution_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`agent_id` text,
	`skill_name` text NOT NULL,
	`session_key` text,
	`status` text NOT NULL,
	`duration_ms` integer,
	`error_message` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_skill_stats_server_skill_time` ON `skill_execution_stats` (`server_id`,`skill_name`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_skill_stats_tenant` ON `skill_execution_stats` (`tenant_id`);