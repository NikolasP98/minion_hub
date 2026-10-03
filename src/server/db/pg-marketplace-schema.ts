import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketplaceAgents } from '@minion-stack/db/pg';

/** Operational state is global and service-role-only; never exposed through tenant RLS. */
export const marketplaceSyncState = pgTable(
  'marketplace_sync_state',
  {
    id: text('id').primaryKey().default('catalog'),
    leaseToken: uuid('lease_token'),
    lastPublishedToken: uuid('last_published_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    directories: jsonb('directories').$type<string[]>().notNull().default([]),
    nextIndex: integer('next_index').notNull().default(0),
    synced: integer('synced').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    errors: jsonb('errors').$type<string[]>().notNull().default([]),
    status: text('status')
      .$type<'idle' | 'running' | 'complete' | 'partial' | 'failed'>()
      .notNull()
      .default('idle'),
    cycleStartedAt: timestamp('cycle_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastSynced: integer('last_synced').notNull().default(0),
    lastFailed: integer('last_failed').notNull().default(0),
    nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true }).notNull().defaultNow(),
    manualEligibleAt: timestamp('manual_eligible_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('marketplace_sync_singleton', sql`${t.id} = 'catalog'`),
    check(
      'marketplace_sync_lease_pair',
      sql`(${t.leaseToken} IS NULL) = (${t.leaseUntil} IS NULL)`,
    ),
    check(
      'marketplace_sync_cursor',
      sql`${t.nextIndex} >= 0 AND ${t.nextIndex} <= jsonb_array_length(${t.directories}) AND jsonb_array_length(${t.directories}) < 1000`,
    ),
    check(
      'marketplace_sync_counts',
      sql`${t.synced} >= 0 AND ${t.failed} >= 0 AND ${t.lastSynced} >= 0 AND ${t.lastFailed} >= 0`,
    ),
    check(
      'marketplace_sync_errors',
      sql`jsonb_array_length(${t.errors}) <= 20 AND octet_length(${t.errors}::text) <= 5000`,
    ),
    check(
      'marketplace_sync_status',
      sql`${t.status} IN ('idle','running','complete','partial','failed')`,
    ),
  ],
);

export const marketplaceFileLoadState = pgTable(
  'marketplace_file_load_state',
  {
    agentId: text('agent_id')
      .primaryKey()
      .references(() => marketplaceAgents.id, { onDelete: 'cascade' }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    nextEligibleAt: timestamp('next_eligible_at', { withTimezone: true }).notNull().defaultNow(),
    errorCode: text('error_code'),
    // An all-404 bundle is verified content too. This survives metadata invalidation.
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedDigest: text('verified_digest'),
  },
  (t) => [
    check(
      'marketplace_file_lease_pair',
      sql`(${t.leaseToken} IS NULL) = (${t.leaseUntil} IS NULL)`,
    ),
    check(
      'marketplace_file_verification',
      sql`(${t.verifiedAt} IS NULL AND ${t.verifiedDigest} IS NULL) OR (${t.verifiedAt} IS NOT NULL AND ${t.verifiedDigest} IS NOT NULL AND ${t.verifiedDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'marketplace_file_error_bound',
      sql`${t.errorCode} IS NULL OR length(${t.errorCode}) <= 64`,
    ),
  ],
);
