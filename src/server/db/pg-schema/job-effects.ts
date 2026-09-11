import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Canonical base DDL/RLS/grants:20260909090300_job_effect_receipts.sql;
 * manifest column/check:20260909090400_job_request_manifest.sql.
 * The constraint function validates persisted 1..64 x1536 finite vectors. */
export const jobEffects = pgTable(
  'job_effects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    family: text('family').notNull(),
    entityId: text('entity_id').notNull(),
    kind: text('kind').notNull(),
    revision: uuid('revision').notNull(),
    unit: text('unit').notNull(),
    sourceHash: text('source_hash').notNull(),
    manifestHash: text('manifest_hash'),
    state: text('state').notNull(),
    descriptor: jsonb('descriptor'),
    result: jsonb('result'),
    legacyJobId: text('legacy_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'job_effects_manifest_shape',
      sql`${t.manifestHash} IS NULL OR
      (${t.kind} = 'head' AND ${t.manifestHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'job_effects_identity',
      sql`length(${t.tenantId}) BETWEEN 1 AND 256 AND length(${t.family}) BETWEEN 1 AND 96
    AND length(${t.entityId}) BETWEEN 1 AND 512 AND ${t.sourceHash} ~ '^[a-f0-9]{64}$' AND ${t.id} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'job_effects_shape',
      sql`(
    (${t.kind} = 'head' AND ${t.unit} = '' AND ${t.state} IN ('active','revoked') AND ${t.descriptor} IS NULL AND ${t.result} IS NULL)
    OR (${t.kind} = 'effect' AND length(${t.unit}) BETWEEN 1 AND 160 AND ${t.legacyJobId} IS NULL
      AND ${t.state} IN ('admitted','received','committed') AND ${t.descriptor} IS NOT NULL
      AND jsonb_typeof(${t.descriptor}) = 'object'
      AND ${t.descriptor} ?& ARRAY['payloadHash','endpoint','model','normalization','count','dimensions','pipelineVersion']
      AND jsonb_typeof(${t.descriptor}->'payloadHash') = 'string'
      AND jsonb_typeof(${t.descriptor}->'endpoint') = 'string'
      AND jsonb_typeof(${t.descriptor}->'model') = 'string'
      AND jsonb_typeof(${t.descriptor}->'normalization') = 'string'
      AND jsonb_typeof(${t.descriptor}->'pipelineVersion') = 'string'
      AND jsonb_typeof(${t.descriptor}->'count') = 'number'
      AND jsonb_typeof(${t.descriptor}->'dimensions') = 'number'
      AND ${t.descriptor}->>'payloadHash' ~ '^[a-f0-9]{64}$'
      AND length(${t.descriptor}->>'endpoint') BETWEEN 1 AND 512
      AND length(${t.descriptor}->>'model') BETWEEN 1 AND 128
      AND length(${t.descriptor}->>'normalization') BETWEEN 1 AND 128
      AND length(${t.descriptor}->>'pipelineVersion') BETWEEN 1 AND 128
      AND ${t.descriptor}->>'count' ~ '^([1-9]|[1-5][0-9]|6[0-4])$'
      AND ${t.descriptor}->>'dimensions' = '1536'
      AND CASE WHEN ${t.state} = 'admitted' THEN ${t.result} IS NULL
        ELSE public.job_effect_vectors_valid(${t.result}, (${t.descriptor}->>'count')::integer) END)) IS TRUE`,
    ),
    uniqueIndex('job_effects_tenant_id_kind').on(t.tenantId, t.id, t.kind),
    uniqueIndex('job_effects_head_identity')
      .on(t.tenantId, t.family, t.entityId)
      .where(sql`${t.kind} = 'head'`),
    uniqueIndex('job_effects_unit_identity')
      .on(t.tenantId, t.family, t.entityId, t.revision, t.unit)
      .where(sql`${t.kind} = 'effect'`),
    index('job_effects_revision').on(t.tenantId, t.family, t.entityId, t.revision),
  ],
);
