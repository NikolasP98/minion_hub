import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { agentArtifacts } from './pg-artifacts-schema';

/**
 * Agent artifact revision history — tracks versions of agent_artifacts.html + prompt.
 * Stored separately to avoid bloating the main artifacts table with old versions.
 * Indexed by (org_id, artifact_id, version) for efficient lookups.
 */
export const agentArtifactRevisions = pgTable(
  'agent_artifact_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    artifactId: uuid('artifact_id').notNull().references(() => agentArtifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    prompt: text('prompt'),
    html: text('html').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idx: index('agent_artifact_revisions_org_artifact_idx').on(t.orgId, t.artifactId, t.version) }),
);

export type AgentArtifactRevisionRow = typeof agentArtifactRevisions.$inferSelect;
