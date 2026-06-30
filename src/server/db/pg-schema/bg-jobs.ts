/**
 * Generic background-job queue (Supabase Postgres, hub-global).
 *
 * Any feature that must survive navigation enqueues here; the bg-runtime cron
 * tick advances jobs server-side. Lives in Supabase PG (feature/operational
 * state), not Turso (telemetry only). Conventions match notes.ts/flows.ts.
 */

import { bigint, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

export const bgJobs = pgTable(
  'bg_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id'),
    type: text('type').notNull(), // handler key, e.g. 'groupchat'
    refId: text('ref_id'), // domain entity id (e.g. groupchat run id)
    status: text('status').notNull().default('queued'), // queued|running|done|failed|cancelled
    cursor: text('cursor'), // JSON handler progress
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: bigint('lease_until', { mode: 'number' }), // ms — stale-running reclaim guard
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    startedAt: bigint('started_at', { mode: 'number' }),
    finishedAt: bigint('finished_at', { mode: 'number' }),
  },
  (t) => [
    index('idx_bgjobs_status').on(t.status),
    index('idx_bgjobs_tenant').on(t.tenantId),
    index('idx_bgjobs_ref').on(t.refId),
  ],
);
