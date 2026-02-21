CREATE TABLE `marketplace_agents` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `category` text NOT NULL,
  `tags` text NOT NULL,
  `description` text NOT NULL,
  `catchphrase` text,
  `version` text NOT NULL,
  `model` text,
  `avatar_seed` text NOT NULL,
  `github_path` text NOT NULL,
  `soul_md` text,
  `identity_md` text,
  `user_md` text,
  `context_md` text,
  `skills_md` text,
  `install_count` integer DEFAULT 0,
  `synced_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `marketplace_installs` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `agent_id` text NOT NULL REFERENCES `marketplace_agents`(`id`) ON DELETE CASCADE,
  `server_id` text NOT NULL REFERENCES `servers`(`id`) ON DELETE CASCADE,
  `installed_at` integer NOT NULL
);

CREATE INDEX `idx_marketplace_installs_tenant` ON `marketplace_installs` (`tenant_id`);
CREATE INDEX `idx_marketplace_installs_agent` ON `marketplace_installs` (`agent_id`);
