import { pgTable, uuid, text, timestamp, index, integer } from 'drizzle-orm/pg-core';

/**
 * Hub-native dynamic artifacts — per-org, per-agent visual bundles (single
 * self-contained index.html). Built-ins stay code-registered; these are
 * DB-stored (manual create now, LLM-generated later). Tenancy: `org_id text`
 * (== messages.org_id), enforced by withOrgCore (role app_ledger +
 * app.current_org_id GUC). Policy/grants in the companion migration
 * 20260619190000_agent_artifacts.sql (meta-repo root).
 */
export const agentArtifacts = pgTable(
  'agent_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    agentId: text('agent_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('LayoutDashboard'),
    html: text('html').notNull(),
    version: integer('version').notNull().default(1),
    prompt: text('prompt'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgAgentIdx: index('agent_artifacts_org_agent_idx').on(t.orgId, t.agentId),
  }),
);

export type AgentArtifactRow = typeof agentArtifacts.$inferSelect;
