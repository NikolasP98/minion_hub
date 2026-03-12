CREATE TABLE `unified_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
	`server_id` text NOT NULL REFERENCES `servers`(`id`) ON DELETE cascade,
	`local_event_id` integer NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`agent_id` text,
	`correlation_id` text,
	`metadata` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_unified_events_tenant` ON `unified_events` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `idx_unified_events_server_cat_time` ON `unified_events` (`server_id`,`category`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_unified_events_server_time` ON `unified_events` (`server_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `idx_unified_events_correlation` ON `unified_events` (`correlation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_unified_events_dedup` ON `unified_events` (`tenant_id`,`server_id`,`local_event_id`);
