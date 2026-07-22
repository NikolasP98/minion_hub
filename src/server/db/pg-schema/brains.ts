import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * P4 AI-Brains — org-scoped knowledge bases. Filed under `pg-schema/` per the
 * bg-jobs.ts/workshop-experiments.ts directory convention (queried via
 * `getCoreDb().select().from(table)`, not the `@minion-stack/db` relational
 * schema — see pg-client.ts / bg-runtime.ts for the precedent: local pg-schema
 * tables never need package registration because every call site uses the
 * plain query builder, not `db.query.*`).
 *
 * Columns (uuid pk, text org_id, timestamptz) mirror the RLS-enforced core
 * tables (`pg-party-schema.ts`, `pg-activity-schema.ts`) rather than bg-jobs'
 * text-id/epoch-ms shape, because brains ARE org_guc RLS'd — every access
 * goes through `withOrgCore` (role app_ledger + app.current_org_id GUC).
 * Companion RLS + the HNSW vector index live in the hand-written migration
 * `supabase/migrations/20260702120000_brains.sql` — Drizzle never manages
 * roles/policies/extensions/ANN indexes (same as agent_memories).
 */

export const brains = pgTable(
  'brains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    /** 'org' (every org member can read) | 'private' (brain_access governs). */
    visibility: text('visibility').notNull().default('org'),
    /** `master` is the single all-source scope for an org; user scopes are `focused`. */
    kind: text('kind').notNull().default('focused'),
    /** Master membership is implicit rather than materialized in brain_sources. */
    includeAllSources: boolean('include_all_sources').notNull().default(false),
    /** Gateway agentId (pattern `brain-<uuid>`) of this brain's managing agent,
     *  or null when agent management is disabled. Set by
     *  `brain-agents.service.ts`'s provision/deprovision (P4.1). */
    agentId: text('agent_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('brains_org_idx').on(t.orgId),
    uniqueIndex('brains_org_master_uniq')
      .on(t.orgId)
      .where(sql`${t.kind} = 'master'`),
  ],
);
export type Brain = typeof brains.$inferSelect;

export const brainDocuments = pgTable(
  'brain_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brainId: uuid('brain_id').notNull(),
    orgId: text('org_id').notNull(),
    title: text('title').notNull(),
    /** 'note' | 'url' | 'upload' | 'module_ref'. */
    sourceType: text('source_type').notNull(),
    /** URL, file id, or module key (e.g. 'fin_products') depending on sourceType. */
    sourceRef: text('source_ref'),
    contentMd: text('content_md'),
    /** 'pending' | 'ingesting' | 'ready' | 'failed' — advanced by the brain_ingest bg job. */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('brain_documents_org_brain_idx').on(t.orgId, t.brainId)],
);
export type BrainDocument = typeof brainDocuments.$inferSelect;

export const brainChunks = pgTable(
  'brain_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brainId: uuid('brain_id').notNull(),
    documentId: uuid('document_id').notNull(),
    orgId: text('org_id').notNull(),
    seq: integer('seq').notNull(),
    chunkText: text('chunk_text').notNull(),
    // 1536 = text-embedding-3-small (embeddings.ts EMBEDDING_DIMENSIONS), matching
    // agent_memories. HNSW/vector_cosine_ops index is companion-SQL-managed.
    embedding: vector('embedding', { dimensions: 1536 }),
    meta: jsonb('meta'),
  },
  (t) => [
    index('brain_chunks_org_brain_idx').on(t.orgId, t.brainId),
    index('brain_chunks_document_idx').on(t.documentId),
  ],
);
export type BrainChunk = typeof brainChunks.$inferSelect;

export const brainAccess = pgTable(
  'brain_access',
  {
    brainId: uuid('brain_id').notNull(),
    orgId: text('org_id').notNull(),
    /** 'role' | 'user' | 'agent'. */
    principalType: text('principal_type').notNull(),
    /** role key, profiles.id, or gateway agent id, depending on principalType. */
    principalId: text('principal_id').notNull(),
    /** 'read' | 'write'. */
    level: text('level').notNull().default('read'),
  },
  (t) => [
    primaryKey({ columns: [t.brainId, t.principalType, t.principalId] }),
    index('brain_access_org_brain_idx').on(t.orgId, t.brainId),
  ],
);
export type BrainAccessRow = typeof brainAccess.$inferSelect;

/**
 * Canonical org corpus. Sources/documents/chunks are stored once and composed
 * into many focused brains through `brain_sources`; the Master Brain includes
 * every enabled source implicitly.
 */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    connector: text('connector').notNull(),
    externalKey: text('external_key').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull().default({}),
    status: text('status').notNull().default('discovered'),
    syncMode: text('sync_mode').notNull().default('incremental'),
    cadence: text('cadence'),
    watermark: jsonb('watermark').notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('knowledge_sources_org_connector_key_uniq').on(t.orgId, t.connector, t.externalKey),
    index('knowledge_sources_org_status_idx').on(t.orgId, t.status),
  ],
);
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    rawText: text('raw_text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceRevision: text('source_revision'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('knowledge_documents_org_source_external_uniq').on(
      t.orgId,
      t.sourceId,
      t.externalId,
    ),
    index('knowledge_documents_org_source_status_idx').on(t.orgId, t.sourceId, t.status),
    index('knowledge_documents_org_source_updated_idx').on(t.orgId, t.sourceId, t.sourceUpdatedAt),
  ],
);
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    documentId: uuid('document_id').notNull(),
    chunkKey: text('chunk_key').notNull(),
    kind: text('kind').notNull().default('raw'),
    seq: integer('seq').notNull(),
    chunkText: text('chunk_text').notNull(),
    contextPrefix: text('context_prefix'),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddingModel: text('embedding_model'),
    searchVector: tsvector('search_vector'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('knowledge_chunks_org_document_key_uniq').on(t.orgId, t.documentId, t.chunkKey),
    index('knowledge_chunks_org_source_document_idx').on(t.orgId, t.sourceId, t.documentId),
    index('knowledge_chunks_org_source_occurred_idx').on(t.orgId, t.sourceId, t.occurredAt),
  ],
);
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;

export const brainSources = pgTable(
  'brain_sources',
  {
    brainId: uuid('brain_id').notNull(),
    orgId: text('org_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    weight: real('weight').notNull().default(1),
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.brainId, t.sourceId] }),
    index('brain_sources_org_brain_idx').on(t.orgId, t.brainId),
    index('brain_sources_org_source_idx').on(t.orgId, t.sourceId),
  ],
);
export type BrainSource = typeof brainSources.$inferSelect;
