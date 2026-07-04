import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

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
    /** Gateway agentId (pattern `brain-<uuid>`) of this brain's managing agent,
     *  or null when agent management is disabled. Set by
     *  `brain-agents.service.ts`'s provision/deprovision (P4.1). */
    agentId: text('agent_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('brains_org_idx').on(t.orgId)],
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
