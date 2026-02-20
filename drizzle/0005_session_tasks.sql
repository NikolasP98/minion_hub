CREATE TABLE `session_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `server_id` text NOT NULL REFERENCES `servers`(`id`) ON DELETE CASCADE,
  `session_key` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT 'backlog',
  `sort_order` integer NOT NULL DEFAULT 0,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX `idx_session_tasks_tenant` ON `session_tasks` (`tenant_id`);
CREATE INDEX `idx_session_tasks_server_session` ON `session_tasks` (`server_id`, `session_key`);
