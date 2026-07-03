import { error } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import {
  brainAccess,
  brainChunks,
  brainDocuments,
  brains,
  type Brain,
  type BrainAccessRow,
  type BrainDocument,
} from '$server/db/pg-schema/brains';
import { recordAudit, type FieldChange } from './activity.service';
import { embeddingsEnabled, embedTexts, toVectorLiteral } from './embeddings';
import { listProducts } from './finance-products.service';
import { enqueueJob, registerJobHandler, type AdvanceResult, type BgJob } from './bg-runtime';
import { resolveCapabilities } from './rbac.service';
import { assertSafeUrl } from './ssrf-guard';

/**
 * P4 AI-Brains — org-scoped knowledge bases. CRUD + per-brain access
 * resolution + vector search + the `brain_ingest` bg-runtime handler.
 *
 * Every function that reads/writes brain data enforces access itself (fail
 * closed) via `canAccessBrain` — callers (API routes) still gate the coarse
 * `brains` RBAC module capability (create/edit/delete), but per-brain
 * visibility/brain_access is a second, finer-grained layer this service owns.
 */

type Actor = { id: string | null; name: string | null };

/** The caller identity `canAccessBrain` checks against. `roles` are RBAC role
 *  keys (owner/admin/manager/staff/viewer) from the resolved Capabilities. */
export interface AccessPrincipal {
  profileId?: string | null;
  agentId?: string | null;
  roles?: string[];
}

/** Build an `AccessPrincipal` for a signed-in browser caller (API routes).
 *  Gateway callers build their own via `resolveAssistantPrincipal`'s output. */
export async function resolvePrincipal(ctx: CoreCtx): Promise<AccessPrincipal> {
  if (!ctx.profileId) return {};
  const caps = await resolveCapabilities(ctx.tenantId, ctx.profileId);
  return { profileId: ctx.profileId, roles: caps.roles };
}

async function loadBrain(ctx: CoreCtx, brainId: string): Promise<Brain | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brains)
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}

/**
 * Fail-closed access check: creator + org owner/admin always get both levels;
 * `visibility:'org'` grants read to any org member; otherwise a matching
 * `brain_access` row (role/user/agent) is required. Anything unresolved
 * (missing brain, no matching principal) denies.
 */
export async function canAccessBrain(
  ctx: CoreCtx,
  brainId: string,
  level: 'read' | 'write',
  principal: AccessPrincipal,
): Promise<boolean> {
  const brain = await loadBrain(ctx, brainId);
  if (!brain) return false;
  if (principal.profileId && brain.createdBy === principal.profileId) return true;
  if (principal.roles?.some((r) => r === 'owner' || r === 'admin')) return true;
  if (level === 'read' && brain.visibility === 'org') return true;

  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainAccess)
      .where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId))),
  );
  const satisfies = (row: BrainAccessRow) => row.level === 'write' || level === 'read';
  for (const row of rows) {
    if (row.principalType === 'role' && principal.roles?.includes(row.principalId) && satisfies(row)) return true;
    if (row.principalType === 'user' && principal.profileId && row.principalId === principal.profileId && satisfies(row))
      return true;
    if (row.principalType === 'agent' && principal.agentId && row.principalId === principal.agentId && satisfies(row))
      return true;
  }
  return false;
}

async function requireAccess(
  ctx: CoreCtx,
  brainId: string,
  level: 'read' | 'write',
  principal: AccessPrincipal,
): Promise<void> {
  if (!(await canAccessBrain(ctx, brainId, level, principal))) {
    throw error(403, `no ${level} access to this brain`);
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────

/**
 * List brains visible to `principal`: every `visibility:'org'` brain plus any
 * `private` brain with a matching access row. ponytail: per-row access check
 * (N+1) — brains-per-org is small (dozens, not thousands); revisit with a
 * join if that stops being true.
 */
export async function listBrains(ctx: CoreCtx, principal: AccessPrincipal): Promise<Brain[]> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select().from(brains).where(eq(brains.orgId, ctx.tenantId)).orderBy(desc(brains.createdAt)),
  );
  const out: Brain[] = [];
  for (const b of rows) {
    if (b.visibility === 'org' || (await canAccessBrain(ctx, b.id, 'read', principal))) out.push(b);
  }
  return out;
}

export async function getBrain(ctx: CoreCtx, brainId: string, principal: AccessPrincipal): Promise<Brain | null> {
  await requireAccess(ctx, brainId, 'read', principal);
  return loadBrain(ctx, brainId);
}

export async function createBrain(
  ctx: CoreCtx,
  input: { name: string; description?: string | null; icon?: string | null; visibility?: 'org' | 'private' },
  actor: Actor,
): Promise<Brain> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(brains)
      .values({
        orgId: ctx.tenantId,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        visibility: input.visibility ?? 'org',
        createdBy: actor.id,
      })
      .returning(),
  );
  await recordAudit(ctx, {
    refType: 'brain',
    refId: row.id,
    op: 'create',
    changes: [{ field: 'name', label: 'Name', old: null, new: row.name }],
    actor,
  });
  return row;
}

export async function updateBrain(
  ctx: CoreCtx,
  brainId: string,
  patch: { name?: string; description?: string | null; icon?: string | null; visibility?: 'org' | 'private' },
  principal: AccessPrincipal,
  actor: Actor,
): Promise<Brain | null> {
  await requireAccess(ctx, brainId, 'write', principal);
  const before = await loadBrain(ctx, brainId);
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(brains)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .returning(),
  );
  if (!row) return null;
  const changes: FieldChange[] = [];
  const fields: Array<{ field: keyof typeof patch; label: string }> = [
    { field: 'name', label: 'Name' },
    { field: 'description', label: 'Description' },
    { field: 'icon', label: 'Icon' },
    { field: 'visibility', label: 'Visibility' },
  ];
  for (const f of fields) {
    if (f.field in patch && before?.[f.field] !== row[f.field]) {
      changes.push({ field: f.field, label: f.label, old: before?.[f.field] ?? null, new: row[f.field] });
    }
  }
  await recordAudit(ctx, { refType: 'brain', refId: brainId, op: 'update', changes, actor });
  return row;
}

export async function deleteBrain(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
  actor: Actor,
): Promise<boolean> {
  await requireAccess(ctx, brainId, 'write', principal);
  const res = await withOrgCore(ctx, (tx) =>
    tx.delete(brains).where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId))),
  );
  await recordAudit(ctx, {
    refType: 'brain',
    refId: brainId,
    op: 'delete',
    changes: [{ field: 'deleted', label: 'Deleted', old: false, new: true }],
    actor,
  });
  return ((res as unknown as { rowCount?: number })?.rowCount ?? 0) > 0;
}

// ── Documents ────────────────────────────────────────────────────────────

export async function listDocuments(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
): Promise<BrainDocument[]> {
  await requireAccess(ctx, brainId, 'read', principal);
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainDocuments)
      .where(and(eq(brainDocuments.brainId, brainId), eq(brainDocuments.orgId, ctx.tenantId)))
      .orderBy(desc(brainDocuments.updatedAt)),
  );
}

export async function addDocument(
  ctx: CoreCtx,
  brainId: string,
  input: { title: string; sourceType: 'note' | 'url' | 'upload' | 'module_ref'; sourceRef?: string | null; contentMd?: string | null },
  principal: AccessPrincipal,
  actor: Actor,
): Promise<BrainDocument> {
  await requireAccess(ctx, brainId, 'write', principal);
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(brainDocuments)
      .values({
        brainId,
        orgId: ctx.tenantId,
        title: input.title,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
        contentMd: input.contentMd ?? null,
        status: 'pending',
        createdBy: actor.id,
      })
      .returning(),
  );
  await enqueueJob({ tenantId: ctx.tenantId, userId: actor.id, type: 'brain_ingest', refId: row.id });
  await recordAudit(ctx, {
    refType: 'brain_document',
    refId: row.id,
    op: 'create',
    changes: [{ field: 'title', label: 'Title', old: null, new: row.title }],
    actor,
  });
  return row;
}

/** Convenience wrapper for the common case: a `note` document from raw markdown. */
export async function addNote(
  ctx: CoreCtx,
  brainId: string,
  title: string,
  contentMd: string,
  principal: AccessPrincipal,
  actor: Actor,
): Promise<BrainDocument> {
  return addDocument(ctx, brainId, { title, sourceType: 'note', contentMd }, principal, actor);
}

export async function removeDocument(
  ctx: CoreCtx,
  brainId: string,
  docId: string,
  principal: AccessPrincipal,
  actor: Actor,
): Promise<boolean> {
  await requireAccess(ctx, brainId, 'write', principal);
  const res = await withOrgCore(ctx, (tx) =>
    tx
      .delete(brainDocuments)
      .where(and(eq(brainDocuments.id, docId), eq(brainDocuments.brainId, brainId), eq(brainDocuments.orgId, ctx.tenantId))),
  );
  await recordAudit(ctx, {
    refType: 'brain_document',
    refId: docId,
    op: 'delete',
    changes: [{ field: 'deleted', label: 'Deleted', old: false, new: true }],
    actor,
  });
  return ((res as unknown as { rowCount?: number })?.rowCount ?? 0) > 0;
}

/** Reset a document to `pending` and re-enqueue ingestion (the handler is
 *  idempotent — it deletes+reinserts the doc's chunks on every run). */
export async function reingestDocument(
  ctx: CoreCtx,
  brainId: string,
  docId: string,
  principal: AccessPrincipal,
): Promise<void> {
  await requireAccess(ctx, brainId, 'write', principal);
  const res = await withOrgCore(ctx, (tx) =>
    tx
      .update(brainDocuments)
      .set({ status: 'pending', error: null, updatedAt: new Date() })
      .where(and(eq(brainDocuments.id, docId), eq(brainDocuments.brainId, brainId), eq(brainDocuments.orgId, ctx.tenantId)))
      .returning({ id: brainDocuments.id }),
  );
  if (res.length === 0) throw error(404, 'document not found');
  await enqueueJob({ tenantId: ctx.tenantId, type: 'brain_ingest', refId: docId });
}

// ── Search ───────────────────────────────────────────────────────────────

export interface BrainSearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  seq: number;
  chunkText: string;
  score: number;
}

/**
 * Cosine top-k over one brain's chunks (agent-memories.service.ts query shape,
 * without the recency/importance composite — plain relevance is enough for
 * v1). `brainId` is filtered explicitly (defense in depth) on top of the RLS
 * `org_id` scoping — the brain-isolation guarantee a cross-brain query must
 * never leak another brain's chunks.
 */
export async function searchBrain(
  ctx: CoreCtx,
  brainId: string,
  query: string,
  limit: number | undefined,
  principal: AccessPrincipal,
): Promise<BrainSearchHit[]> {
  await requireAccess(ctx, brainId, 'read', principal);
  const q = query.trim();
  if (!q) return [];
  if (!embeddingsEnabled()) throw error(503, 'embeddings are not configured');
  const [vec] = await embedTexts([q]);
  const lit = toVectorLiteral(vec);
  const cap = Math.min(limit ?? 10, 50);
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        chunkId: brainChunks.id,
        documentId: brainChunks.documentId,
        seq: brainChunks.seq,
        chunkText: brainChunks.chunkText,
        documentTitle: brainDocuments.title,
        score: sql<number>`1 - (${brainChunks.embedding} <=> ${lit}::vector)`,
      })
      .from(brainChunks)
      .innerJoin(brainDocuments, eq(brainDocuments.id, brainChunks.documentId))
      .where(
        and(
          eq(brainChunks.brainId, brainId),
          eq(brainChunks.orgId, ctx.tenantId),
          sql`${brainChunks.embedding} is not null`,
        ),
      )
      .orderBy(sql`${brainChunks.embedding} <=> ${lit}::vector`)
      .limit(cap),
  );
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

// ── Access management ───────────────────────────────────────────────────

export async function listAccess(ctx: CoreCtx, brainId: string, principal: AccessPrincipal): Promise<BrainAccessRow[]> {
  await requireAccess(ctx, brainId, 'write', principal);
  return withOrgCore(ctx, (tx) =>
    tx.select().from(brainAccess).where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId))),
  );
}

/** Replace-all: the caller's full desired access-row set for this brain. */
export async function setAccess(
  ctx: CoreCtx,
  brainId: string,
  rows: Array<{ principalType: 'role' | 'user' | 'agent'; principalId: string; level: 'read' | 'write' }>,
  principal: AccessPrincipal,
): Promise<void> {
  await requireAccess(ctx, brainId, 'write', principal);
  await withOrgCore(ctx, async (tx) => {
    await tx.delete(brainAccess).where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId)));
    if (rows.length > 0) {
      await tx.insert(brainAccess).values(
        rows.map((r) => ({ brainId, orgId: ctx.tenantId, principalType: r.principalType, principalId: r.principalId, level: r.level })),
      );
    }
  });
}

// ── Chunking (pure) ──────────────────────────────────────────────────────

/**
 * Split text into ~`size`-char windows on paragraph boundaries, with `overlap`
 * chars of trailing context carried into the next chunk. A single paragraph
 * longer than `size` is hard-split (still carrying the overlap tail).
 */
export function chunkText(text: string, size = 3000, overlap = 300): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const paragraphs = clean
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > size && current) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      current = candidate;
    }
    while (current.length > size) {
      chunks.push(current.slice(0, size));
      current = current.slice(size - overlap);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Embed in bounded batches so one huge document can't blow past the
 *  embeddings provider's per-request item cap. */
async function embedInBatches(texts: string[], batchSize = 64): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    out.push(...(await embedTexts(texts.slice(i, i + batchSize))));
  }
  return out;
}

// ── module_ref rendering ─────────────────────────────────────────────────

/** v1: only `fin_products`. Renders the org's product catalog to markdown rows. */
async function renderModuleRef(ctx: CoreCtx, sourceRef: string | null): Promise<string> {
  if (sourceRef !== 'fin_products') {
    throw new Error(`module_ref '${sourceRef ?? ''}' is not supported (v1: fin_products only)`);
  }
  const products = await listProducts(ctx);
  const header = '| Code | Name | Category | Unit price | Active |\n| --- | --- | --- | --- | --- |';
  const rows = products.map(
    (p) => `| ${p.code} | ${p.name} | ${p.category ?? ''} | ${p.unitPrice ?? ''} | ${p.active ? 'yes' : 'no'} |`,
  );
  return [header, ...rows].join('\n');
  // P2 hub_events hook: re-enqueue module_ref docs on finance.invoices_upserted
  // (products change rarely but should still refresh periodically / on event).
}

const URL_FETCH_TIMEOUT_MS = 15_000;
const URL_FETCH_MAX_REDIRECTS = 3;

/**
 * Fetch a URL and strip it to plain text, capped + time-bounded.
 *
 * SSRF hardening reuses `ssrf-guard.ts` (the same guard `/api/notes/fetch-image`
 * uses): `assertSafeUrl` rejects non-http(s) schemes, loopback/private/
 * link-local/CGNAT/unique-local IPs, and resolves the hostname via DNS so a
 * rebind can't slip through. Redirects are followed manually (`redirect:
 * 'manual'`) and each hop is re-validated before being fetched — a 3xx to an
 * internal IP is caught the same as a direct request. Residual: DNS is
 * re-resolved at connect time by `fetch` itself (TOCTOU) — a custom dialer
 * pinning the checked IP would close that gap but isn't worth the complexity
 * for a note-ingestion source; the existing guard is what every other
 * user-supplied-URL fetch in this codebase relies on.
 */
async function fetchUrlContent(url: string): Promise<string> {
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  let html: string;
  try {
    for (let hop = 0; ; hop++) {
      if (hop > URL_FETCH_MAX_REDIRECTS) throw new Error('too many redirects');
      await assertSafeUrl(current, 'brain document URL');
      const res = await fetch(current, { redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('redirect without a location');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      html = (await res.text()).slice(0, 100_000);
      break;
    }
  } finally {
    clearTimeout(timer);
  }
  // ponytail: regex tag-strip, not a real HTML parser — good enough for
  // "give the model readable text", not for structure-sensitive extraction.
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadDocumentContent(ctx: CoreCtx, doc: BrainDocument): Promise<string> {
  switch (doc.sourceType) {
    case 'note':
      return doc.contentMd ?? '';
    case 'url':
      if (!doc.sourceRef) throw new Error('url document is missing source_ref');
      return fetchUrlContent(doc.sourceRef);
    case 'module_ref':
      return renderModuleRef(ctx, doc.sourceRef);
    case 'upload':
      throw new Error('uploads not yet supported');
    default:
      throw new Error(`unknown source_type '${doc.sourceType}'`);
  }
}

// ── Ingestion (bg-runtime handler) ──────────────────────────────────────

/**
 * One advance() = process ONE document fully: load content, chunk, embed,
 * replace its chunks, flip status. `job.refId` is the document id;
 * `job.tenantId` is the org — reconstructed into a CoreCtx so the handler can
 * run inside `withOrgCore` (brain_documents/brain_chunks are force-RLS'd).
 */
async function advanceBrainIngest(job: BgJob): Promise<AdvanceResult> {
  const documentId = job.refId;
  if (!documentId) return { done: true, error: 'brain_ingest job is missing refId (document id)' };
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: job.tenantId };

  const [doc] = await withOrgCore(ctx, (tx) =>
    tx.select().from(brainDocuments).where(eq(brainDocuments.id, documentId)).limit(1),
  );
  if (!doc) return { done: true, error: 'document not found' };

  await withOrgCore(ctx, (tx) =>
    tx.update(brainDocuments).set({ status: 'ingesting', updatedAt: new Date() }).where(eq(brainDocuments.id, documentId)),
  );

  try {
    const text = await loadDocumentContent(ctx, doc);
    const pieces = chunkText(text);
    const vectors = pieces.length > 0 && embeddingsEnabled() ? await embedInBatches(pieces) : [];

    await withOrgCore(ctx, async (tx) => {
      await tx.delete(brainChunks).where(eq(brainChunks.documentId, documentId));
      if (pieces.length > 0) {
        await tx.insert(brainChunks).values(
          pieces.map((chunk, i) => ({
            brainId: doc.brainId,
            documentId,
            orgId: job.tenantId,
            seq: i,
            chunkText: chunk,
            embedding: vectors[i] ?? null,
          })),
        );
      }
      await tx
        .update(brainDocuments)
        .set({ status: 'ready', error: null, updatedAt: new Date() })
        .where(eq(brainDocuments.id, documentId));
    });
    return { done: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withOrgCore(ctx, (tx) =>
      tx.update(brainDocuments).set({ status: 'failed', error: message, updatedAt: new Date() }).where(eq(brainDocuments.id, documentId)),
    );
    return { done: true, error: message };
  }
}

registerJobHandler({ type: 'brain_ingest', advance: advanceBrainIngest });
