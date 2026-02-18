CREATE TABLE `reliability_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`server_id` text NOT NULL,
	`agent_id` text,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rel_events_server_cat_time` ON `reliability_events` (`server_id`,`category`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_rel_events_server_time` ON `reliability_events` (`server_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_rel_events_tenant` ON `reliability_events` (`tenant_id`);