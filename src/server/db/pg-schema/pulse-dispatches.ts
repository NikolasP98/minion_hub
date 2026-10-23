import { bigint, integer, pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

export const pulseDispatches = pgTable(
  'pulse_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    proposalId: uuid('proposal_id').notNull(),
    proposalRevision: integer('proposal_revision').notNull(),
    actorProfileId: text('actor_profile_id').notNull(),
    gatewayId: uuid('gateway_id').notNull(),
    channel: text('channel').notNull(),
    agentId: text('agent_id').notNull(),
    originSessionKey: text('origin_session_key').notNull(),
    actionKind: text('action_kind').notNull(),
    payload: text('payload'),
    payloadHash: text('payload_hash').notNull(),
    toolSchemaRevision: text('tool_schema_revision').notNull(),
    authoritySnapshotHash: text('authority_snapshot_hash').notNull(),
    gatewayQualificationRevision: text('gateway_qualification_revision').notNull(),
    state: text('state').notNull().default('queued'),
    bgJobId: text('bg_job_id').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }),
    admittedAt: timestamp('admitted_at', { withTimezone: true }),
    admittedGeneration: integer('admitted_generation'),
    remoteJobId: text('remote_job_id'),
    safeReason: text('safe_reason'),
    payloadRedactedAt: timestamp('payload_redacted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('pulse_dispatches_proposal_revision_uq').on(t.orgId, t.proposalId, t.proposalRevision),
    unique('pulse_dispatches_org_id_uq').on(t.orgId, t.id),
  ],
);
export type PulseDispatchRow = typeof pulseDispatches.$inferSelect;
