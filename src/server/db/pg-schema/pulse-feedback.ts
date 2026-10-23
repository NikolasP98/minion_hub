import { pgTable, text, uuid, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
export const pulseFeedback = pgTable('pulse_feedback', {
  sourceRevisions: jsonb('source_revisions')
    .$type<{ sourceId: string; revision: number; contentHash: string }[]>()
    .notNull(),
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull(),
  ownerProfileId: text('owner_profile_id').notNull(),
  actorProfileId: text('actor_profile_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  contentRevision: integer('content_revision').notNull(),
  digestRunId: uuid('digest_run_id').notNull(),
  policyRevision: text('policy_revision').notNull(),
  sourceSnapshotHash: text('source_snapshot_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  reason: text('reason').notNull(),
  comment: text('comment'),
  clientActionId: uuid('client_action_id').notNull(),
  supersedesFeedbackId: uuid('supersedes_feedback_id'),
  payloadHash: text('payload_hash').notNull(),
  redactedAt: timestamp('redacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PulseFeedbackRow = typeof pulseFeedback.$inferSelect;
