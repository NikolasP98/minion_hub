import { and, desc, eq, sql } from 'drizzle-orm';
import { agentMemories } from '@minion-stack/db/pg';
import { withOrg } from '$server/db/pg-ledger-client';
import { toVectorLiteral } from './embeddings';
import { pca2d } from './pca';

/**
 * Agent memory corpus service. `agent_memories` is forced-RLS like `messages`,
 * so every access goes through `withOrg(orgId, …)` (SET LOCAL ROLE app_ledger +
 * app.current_org_id GUC). Org isolation is enforced by the policy — services
 * never add an explicit org filter, only narrower predicates (agentId, etc.).
 */

export type AgentMemoryInsert = typeof agentMemories.$inferInsert;

/** Allowed memory categories — enforced on ingest (untyped gateway JSON). */
export const CATEGORIES = ['preference', 'fact', 'decision', 'entity', 'other'] as const;
export type MemoryCategory = (typeof CATEGORIES)[number];

export interface MemoryInput {
  agentId: string;
  content: string;
  category?: MemoryCategory;
  importance?: number;
  source?: string;
  sourceId?: string | null;
  profileId?: string | null;
  gatewayId?: string | null;
  embedding?: number[] | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown>;
}

/** A memory row for the UI — excludes the 1536-float embedding payload. */
export interface MemoryRow {
  id: string;
  agentId: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  createdAt: string;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
}

const ROW_SELECT = {
  id: agentMemories.id,
  agentId: agentMemories.agentId,
  content: agentMemories.content,
  category: agentMemories.category,
  importance: agentMemories.importance,
  source: agentMemories.source,
  createdAt: agentMemories.createdAt,
  occurredAt: agentMemories.occurredAt,
  metadata: agentMemories.metadata,
} as const;

function toInsertValues(orgId: string, m: MemoryInput): AgentMemoryInsert {
  return {
    orgId,
    gatewayId: m.gatewayId ?? null,
    agentId: m.agentId,
    profileId: m.profileId ?? null,
    content: m.content,
    embedding: m.embedding ?? null,
    category: (CATEGORIES as readonly string[]).includes(m.category as string)
      ? (m.category as MemoryCategory)
      : 'other',
    importance: m.importance ?? 0.5,
    source: m.source ?? 'manual',
    sourceId: m.sourceId ?? null,
    occurredAt: m.occurredAt ?? null,
    metadata: m.metadata ?? {},
  };
}

/**
 * Upsert memories (idempotent on the org+source+source_id partial unique index).
 * Embeddings are expected to be pre-computed by the caller. Returns inserted count.
 */
export async function upsertMemories(orgId: string, memories: MemoryInput[]): Promise<number> {
  if (memories.length === 0) return 0;
  const values = memories.map((m) => toInsertValues(orgId, m));
  await withOrg(orgId, async (tx) => {
    await tx
      .insert(agentMemories)
      .values(values)
      .onConflictDoUpdate({
        target: [agentMemories.orgId, agentMemories.source, agentMemories.sourceId],
        // Matches the partial unique index `agent_memories_source_uniq`
        // (WHERE source_id IS NOT NULL). Without this predicate Postgres can't
        // use the partial index as the ON CONFLICT arbiter. Rows with a null
        // source_id simply insert (they have no idempotency key).
        targetWhere: sql`${agentMemories.sourceId} is not null`,
        set: {
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
          importance: sql`excluded.importance`,
          category: sql`excluded.category`,
          updatedAt: sql`now()`,
        },
      });
  });
  return values.length;
}

/** List recent memories for an agent (newest first). No embedding payload. */
export async function listMemories(
  orgId: string,
  opts: { agentId: string; limit?: number; offset?: number },
): Promise<MemoryRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select(ROW_SELECT)
      .from(agentMemories)
      .where(eq(agentMemories.agentId, opts.agentId))
      .orderBy(desc(agentMemories.createdAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(serializeRow);
}

/** Category counts for an agent — drives the viz filter pills. */
export async function memoryStats(
  orgId: string,
  agentId: string,
): Promise<{ category: string; count: number }[]> {
  return withOrg(orgId, (tx) =>
    tx
      .select({ category: agentMemories.category, count: sql<number>`count(*)::int` })
      .from(agentMemories)
      .where(eq(agentMemories.agentId, agentId))
      .groupBy(agentMemories.category),
  );
}

export interface MemorySearchHit extends MemoryRow {
  score: number;
}

/**
 * Semantic nearest-neighbour search via pgvector cosine distance (`<=>`).
 * `queryEmbedding` must be a 1536-dim vector from the same embedding model.
 */
export async function searchMemories(
  orgId: string,
  opts: { agentId: string; queryEmbedding: number[]; limit?: number },
): Promise<MemorySearchHit[]> {
  const limit = Math.min(opts.limit ?? 20, 200);
  const lit = toVectorLiteral(opts.queryEmbedding);
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        ...ROW_SELECT,
        score: sql<number>`1 - (${agentMemories.embedding} <=> ${lit}::vector)`,
      })
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, opts.agentId), sql`${agentMemories.embedding} is not null`))
      .orderBy(sql`${agentMemories.embedding} <=> ${lit}::vector`)
      .limit(limit),
  );
  return rows.map((r) => ({ ...serializeRow(r), score: Number(r.score) }));
}

export interface ScatterPoint {
  id: string;
  content: string;
  category: string;
  importance: number;
  x: number;
  y: number;
}

/**
 * 2D PCA projection of an agent's memory embeddings for the semantic scatter.
 * Only rows with an embedding are included; capped at 1000 points.
 */
export async function scatterMemories(orgId: string, agentId: string): Promise<ScatterPoint[]> {
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        category: agentMemories.category,
        importance: agentMemories.importance,
        embedding: agentMemories.embedding,
      })
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, agentId), sql`${agentMemories.embedding} is not null`))
      .limit(1000),
  );
  const withVec = rows.filter((r) => Array.isArray(r.embedding));
  const coords = pca2d(withVec.map((r) => r.embedding as number[]));
  return withVec.map((r, i) => ({
    id: r.id,
    content: r.content,
    category: r.category,
    importance: r.importance,
    x: coords[i]?.x ?? 0,
    y: coords[i]?.y ?? 0,
  }));
}

function serializeRow(r: {
  id: string;
  agentId: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  createdAt: Date;
  occurredAt: Date | null;
  metadata: unknown;
}): MemoryRow {
  return {
    id: r.id,
    agentId: r.agentId,
    content: r.content,
    category: r.category,
    importance: r.importance,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    occurredAt: r.occurredAt ? r.occurredAt.toISOString() : null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}
