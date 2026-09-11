import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobEffects } from './job-effects';

/** Canonical transition/deferred membership enforcement and RLS: additive905. */
export const jobEffectPages = pgTable(
  'job_effect_pages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    jobId: text('job_id').notNull(),
    pageKey: text('page_key').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    descriptor: jsonb('descriptor').notNull(),
    state: text('state').notNull().default('bound'),
    completion: jsonb('completion'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_effect_pages_job_key').on(t.tenantId, t.jobId, t.pageKey),
    check(
      'job_effect_pages_identity',
      sql`${t.id} ~ '^[a-f0-9]{64}$' AND length(${t.tenantId}) BETWEEN 1 AND 256 AND length(${t.jobId}) BETWEEN 1 AND 256 AND length(${t.pageKey}) BETWEEN 1 AND 160 AND ${t.manifestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'job_effect_pages_shape',
      sql`(jsonb_typeof(${t.descriptor})='object' AND octet_length(${t.descriptor}::text)<=262144 AND ((${t.state}='bound' AND ${t.completion} IS NULL) OR (${t.state}='published' AND jsonb_typeof(${t.completion})='object'))) IS TRUE`,
    ),
  ],
);

export const jobEffectBatches = pgTable(
  'job_effect_batches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    reservationJobId: text('reservation_job_id').notNull(),
    reservationGeneration: integer('reservation_generation').notNull(),
    dispatchJobId: text('dispatch_job_id'),
    dispatchGeneration: integer('dispatch_generation'),
    descriptor: jsonb('descriptor').notNull(),
    unitIds: jsonb('unit_ids').$type<string[]>().notNull(),
    membershipHash: text('membership_hash').notNull(),
    count: integer('count').notNull(),
    state: text('state').notNull().default('reserved'),
    result: jsonb('result'),
    abandonmentReason: text('abandonment_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_effect_batches_tenant_id').on(t.tenantId, t.id),
    index('job_effect_batches_owner').on(t.tenantId, t.reservationJobId),
    check(
      'job_effect_batches_identity',
      sql`${t.id} ~ '^[a-f0-9]{64}$' AND length(${t.tenantId}) BETWEEN 1 AND 256 AND length(${t.reservationJobId}) BETWEEN 1 AND 256 AND ${t.reservationGeneration}>=0 AND ${t.membershipHash} ~ '^[a-f0-9]{64}$' AND ${t.count} BETWEEN 1 AND 64`,
    ),
    check(
      'job_effect_batches_descriptor',
      sql`public.job_effect_batch_descriptor_valid(${t.descriptor},${t.unitIds},${t.count})`,
    ),
    check(
      'job_effect_batches_shape',
      sql`(((${t.state} IN ('reserved','abandoned_unsent') AND ${t.dispatchJobId} IS NULL AND ${t.dispatchGeneration} IS NULL AND ${t.result} IS NULL) OR (${t.state} IN ('admitted','received') AND length(${t.dispatchJobId}) BETWEEN 1 AND 256 AND ${t.dispatchGeneration}>=0 AND ((${t.state}='admitted' AND ${t.result} IS NULL) OR (${t.state}='received' AND public.job_effect_vectors_valid(${t.result},${t.count}))))) AND ((${t.state}='abandoned_unsent' AND length(${t.abandonmentReason}) BETWEEN 1 AND 160) OR (${t.state}<>'abandoned_unsent' AND ${t.abandonmentReason} IS NULL))) IS TRUE`,
    ),
  ],
);

export const jobEffectUnits = pgTable(
  'job_effect_units',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    headId: text('head_id').notNull(),
    headKind: text('head_kind').notNull().default('head'),
    revision: uuid('revision').notNull(),
    sourceHash: text('source_hash').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    chunkKey: text('chunk_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    policyHash: text('policy_hash').notNull(),
    batchId: text('batch_id'),
    vectorIndex: integer('vector_index'),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'job_effect_units_head_fk',
      columns: [t.tenantId, t.headId, t.headKind],
      foreignColumns: [jobEffects.tenantId, jobEffects.id, jobEffects.kind],
    }),
    foreignKey({
      name: 'job_effect_units_batch_fk',
      columns: [t.tenantId, t.batchId],
      foreignColumns: [jobEffectBatches.tenantId, jobEffectBatches.id],
    }),
    uniqueIndex('job_effect_units_semantic').on(
      t.tenantId,
      t.headId,
      t.revision,
      t.sourceHash,
      t.manifestHash,
      t.chunkKey,
      t.payloadHash,
      t.policyHash,
    ),
    uniqueIndex('job_effect_units_position')
      .on(t.tenantId, t.batchId, t.vectorIndex)
      .where(sql`${t.batchId} IS NOT NULL`),
    check(
      'job_effect_units_identity',
      sql`${t.id} ~ '^[a-f0-9]{64}$' AND length(${t.tenantId}) BETWEEN 1 AND 256 AND ${t.headKind}='head' AND ${t.sourceHash} ~ '^[a-f0-9]{64}$' AND ${t.manifestHash} ~ '^[a-f0-9]{64}$' AND ${t.payloadHash} ~ '^[a-f0-9]{64}$' AND ${t.policyHash} ~ '^[a-f0-9]{64}$' AND length(${t.chunkKey}) BETWEEN 1 AND 160`,
    ),
    check(
      'job_effect_units_placement',
      sql`((${t.batchId} IS NULL AND ${t.vectorIndex} IS NULL) OR (${t.batchId} IS NOT NULL AND ${t.vectorIndex} BETWEEN 0 AND 63)) IS TRUE`,
    ),
  ],
);
