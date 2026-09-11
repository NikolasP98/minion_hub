import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
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
import {
  embeddingsEnabled,
  embedTexts,
  prepareEmbeddingRequest,
  toVectorLiteral,
} from './embeddings';
import { listProducts } from './finance-products.service';
import { listContactsCached, listTags } from './crm-contacts.service';
import { listItems, getBins } from './stock.service';
import {
  registerJobHandler,
  type AdvanceResult,
  type BgJob,
  type JobExecution,
} from './bg-runtime';
import {
  createJobRequest,
  revokeJobRequest,
  readJobRequest,
  withJobRequest,
  bindJobManifest,
  runJobEmbedding,
  commitJobEffects,
  jobRequestAdvanceResult,
  JobEffectError,
  type JobRequest,
} from './job-effects.service';
import {
  resolveCapabilities,
  type Capabilities,
  type Module,
  type PermAction,
} from './rbac.service';
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
  /** Effective RBAC module visibility used to intersect source-level access. */
  visibleModules?: string[];
  /** Modules safe for source-wide semantic search. Owner-scoped modules are
   * deliberately omitted because Brain retrieval cannot apply record ownership. */
  searchableModules?: string[];
  /** Effective ERPNext-style field sensitivity level by visible module. */
  fieldLevels?: Record<string, number>;
}

type BrainSourceCapabilities = Pick<Capabilities, 'visibleModules' | 'ownerScoped' | 'fieldLevel'>;

/** Convert general Hub capabilities into the narrower source-wide access that
 * semantic retrieval can safely enforce. */
export function brainSourceAccess(
  capabilities: BrainSourceCapabilities,
): Pick<AccessPrincipal, 'visibleModules' | 'searchableModules' | 'fieldLevels'> {
  const visibleModules = capabilities.visibleModules();
  return {
    visibleModules,
    searchableModules: visibleModules.filter((module) => !capabilities.ownerScoped(module)),
    fieldLevels: Object.fromEntries(
      visibleModules.map((module) => [module, capabilities.fieldLevel(module)]),
    ),
  };
}

/** Build an `AccessPrincipal` for a signed-in browser caller (API routes).
 *  Gateway callers build their own via `resolveAssistantPrincipal`'s output. */
export async function resolvePrincipal(ctx: CoreCtx): Promise<AccessPrincipal> {
  if (!ctx.profileId) return {};
  const caps = await resolveCapabilities(ctx.tenantId, ctx.profileId);
  return { profileId: ctx.profileId, roles: caps.roles, ...brainSourceAccess(caps) };
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
    if (
      row.principalType === 'role' &&
      principal.roles?.includes(row.principalId) &&
      satisfies(row)
    )
      return true;
    if (
      row.principalType === 'user' &&
      principal.profileId &&
      row.principalId === principal.profileId &&
      satisfies(row)
    )
      return true;
    if (
      row.principalType === 'agent' &&
      principal.agentId &&
      row.principalId === principal.agentId &&
      satisfies(row)
    )
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

export async function getBrain(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
): Promise<Brain | null> {
  await requireAccess(ctx, brainId, 'read', principal);
  return loadBrain(ctx, brainId);
}

export async function createBrain(
  ctx: CoreCtx,
  input: {
    name: string;
    description?: string | null;
    icon?: string | null;
    visibility?: 'org' | 'private';
  },
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
  patch: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    visibility?: 'org' | 'private';
  },
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
      changes.push({
        field: f.field,
        label: f.label,
        old: before?.[f.field] ?? null,
        new: row[f.field],
      });
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

const BRAIN_INGEST_FAMILY = 'brain.document';
const BRAIN_INGEST_PIPELINE = 'brain-chunks-v1-size3000-overlap300-batch64';
type DocumentSource = Pick<
  BrainDocument,
  'id' | 'brainId' | 'orgId' | 'sourceType' | 'sourceRef' | 'contentMd'
>;
function documentSourceHash(doc: DocumentSource): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        doc.id,
        doc.brainId,
        doc.orgId,
        doc.sourceType,
        doc.sourceRef,
        doc.contentMd,
      ]),
    )
    .digest('hex');
}

async function lockedDocument(tx: CoreTx, tenantId: string, request: JobRequest) {
  const [doc] = await tx
    .select()
    .from(brainDocuments)
    .where(and(eq(brainDocuments.id, request.entityId), eq(brainDocuments.orgId, tenantId)))
    .for('update');
  if (!doc) throw new JobEffectError('superseded', 'Brain document no longer exists');
  if (documentSourceHash(doc) !== request.sourceHash)
    throw new JobEffectError('conflict', 'Brain document source changed');
  return doc;
}

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
  input: {
    title: string;
    sourceType: 'note' | 'url' | 'upload' | 'module_ref';
    sourceRef?: string | null;
    contentMd?: string | null;
  },
  principal: AccessPrincipal,
  actor: Actor,
): Promise<BrainDocument> {
  await requireAccess(ctx, brainId, 'write', principal);
  const id = randomUUID();
  const brain = await loadBrain(ctx, brainId);
  if (!brain) throw error(404, 'brain not found');
  const source: DocumentSource = {
    id,
    brainId: brain.id,
    orgId: ctx.tenantId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    contentMd: input.contentMd ?? null,
  };
  const { value: row } = await createJobRequest(
    ctx,
    { family: BRAIN_INGEST_FAMILY, entityId: id },
    documentSourceHash(source),
    { type: 'brain_ingest', userId: actor.id, refId: id },
    async (tx) => {
      const [created] = await tx
        .insert(brainDocuments)
        .values({
          ...source,
          title: input.title,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef ?? null,
          contentMd: input.contentMd ?? null,
          status: 'pending',
          createdBy: actor.id,
        })
        .returning();
      return created;
    },
  );
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
  const [before] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainDocuments)
      .where(
        and(
          eq(brainDocuments.id, docId),
          eq(brainDocuments.brainId, brainId),
          eq(brainDocuments.orgId, ctx.tenantId),
        ),
      ),
  );
  const res = before
    ? await revokeJobRequest(ctx, { family: BRAIN_INGEST_FAMILY, entityId: before.id }, (tx) =>
        tx
          .delete(brainDocuments)
          .where(
            and(
              eq(brainDocuments.id, docId),
              eq(brainDocuments.brainId, brainId),
              eq(brainDocuments.orgId, ctx.tenantId),
            ),
          )
          .returning({ id: brainDocuments.id }),
      )
    : [];
  await recordAudit(ctx, {
    refType: 'brain_document',
    refId: docId,
    op: 'delete',
    changes: [{ field: 'deleted', label: 'Deleted', old: false, new: true }],
    actor,
  });
  return res.length > 0;
}

/** Explicit new intent: atomically revise the request, reset and enqueue.
 * Existing published chunks remain visible until the new revision commits. */
export async function reingestDocument(
  ctx: CoreCtx,
  brainId: string,
  docId: string,
  principal: AccessPrincipal,
): Promise<void> {
  await requireAccess(ctx, brainId, 'write', principal);
  const [before] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainDocuments)
      .where(
        and(
          eq(brainDocuments.id, docId),
          eq(brainDocuments.brainId, brainId),
          eq(brainDocuments.orgId, ctx.tenantId),
        ),
      ),
  );
  if (!before) throw error(404, 'document not found');
  await createJobRequest(
    ctx,
    { family: BRAIN_INGEST_FAMILY, entityId: before.id },
    documentSourceHash(before),
    { type: 'brain_ingest', refId: before.id },
    async (tx, request) => {
      await lockedDocument(tx, ctx.tenantId, request);
      const res = await tx
        .update(brainDocuments)
        .set({ status: 'pending', error: null, updatedAt: new Date() })
        .where(
          and(
            eq(brainDocuments.id, docId),
            eq(brainDocuments.brainId, brainId),
            eq(brainDocuments.orgId, ctx.tenantId),
          ),
        )
        .returning({ id: brainDocuments.id });
      if (res.length === 0) throw error(404, 'document not found');
    },
  );
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

export async function listAccess(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
): Promise<BrainAccessRow[]> {
  await requireAccess(ctx, brainId, 'write', principal);
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainAccess)
      .where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId))),
  );
}

/** Replace-all: the caller's full desired access-row set for this brain. */
export async function setAccess(
  ctx: CoreCtx,
  brainId: string,
  rows: Array<{
    principalType: 'role' | 'user' | 'agent';
    principalId: string;
    level: 'read' | 'write';
  }>,
  principal: AccessPrincipal,
): Promise<void> {
  await requireAccess(ctx, brainId, 'write', principal);
  await withOrgCore(ctx, async (tx) => {
    await tx
      .delete(brainAccess)
      .where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId)));
    if (rows.length > 0) {
      await tx.insert(brainAccess).values(
        rows.map((r) => ({
          brainId,
          orgId: ctx.tenantId,
          principalType: r.principalType,
          principalId: r.principalId,
          level: r.level,
        })),
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

// ── module_ref rendering ─────────────────────────────────────────────────

/** Renders the org's product catalog to markdown rows. */
async function renderFinProducts(ctx: CoreCtx): Promise<string> {
  const products = await listProducts(ctx);
  const header =
    '| Code | Name | Category | Unit price | Active |\n| --- | --- | --- | --- | --- |';
  const rows = products.map(
    (p) =>
      `| ${p.code} | ${p.name} | ${p.category ?? ''} | ${p.unitPrice ?? ''} | ${p.active ? 'yes' : 'no'} |`,
  );
  return [header, ...rows].join('\n');
}

const CRM_CONTACTS_ROW_CAP = 2000;

/** Renders the org's CRM contacts (name, lifecycle stage, tags, contact dates)
 *  to markdown rows. Capped so one huge roster can't blow past chunking. */
async function renderCrmContacts(ctx: CoreCtx): Promise<string> {
  const [contacts, tags] = await Promise.all([listContactsCached(ctx), listTags(ctx)]);
  const tagName = new Map(tags.map((t) => [t.id as string, t.name as string]));
  const header =
    '| Name | Stage | Tags | First contact | Last contact |\n| --- | --- | --- | --- | --- |';
  const capped = contacts.slice(0, CRM_CONTACTS_ROW_CAP);
  const rows = capped.map((c) => {
    const tagLabels = (c.tag_ids ?? []).map((id) => tagName.get(id) ?? id).join(', ');
    return `| ${c.display_name ?? '(unnamed)'} | ${c.stage} | ${tagLabels} | ${c.first_contact_at ?? ''} | ${c.last_contact_at ?? ''} |`;
  });
  const lines = [header, ...rows];
  if (contacts.length > CRM_CONTACTS_ROW_CAP) {
    lines.push(`\n_...and ${contacts.length - CRM_CONTACTS_ROW_CAP} more contacts (truncated)._`);
  }
  return lines.join('\n');
}

const STK_ITEMS_ROW_CAP = 2000;

/** Renders the org's stock items (name, uom, qty on hand summed across
 *  warehouses from the bins cache) to markdown rows. Capped like crm_contacts. */
async function renderStkItems(ctx: CoreCtx): Promise<string> {
  const [items, bins] = await Promise.all([listItems(ctx), getBins(ctx)]);
  const qtyByItem = new Map<string, number>();
  for (const b of bins) qtyByItem.set(b.itemId, (qtyByItem.get(b.itemId) ?? 0) + Number(b.qty));
  const header = '| Item | UoM | Qty on hand |\n| --- | --- | --- |';
  const capped = items.slice(0, STK_ITEMS_ROW_CAP);
  const rows = capped.map((i) => `| ${i.name} | ${i.uom} | ${qtyByItem.get(i.id) ?? 0} |`);
  const lines = [header, ...rows];
  if (items.length > STK_ITEMS_ROW_CAP) {
    lines.push(`\n_...and ${items.length - STK_ITEMS_ROW_CAP} more items (truncated)._`);
  }
  return lines.join('\n');
}

/** Catalog of "connect app data" (`module_ref`) sources. Each entry renders one
 *  business module's org data to markdown, which then goes through the same
 *  chunk/embed pipeline as any other document. `labelKey`/`descriptionKey` are
 *  paraglide message KEY NAMES (not resolved strings) — server code doesn't call
 *  `m.*()`, the client resolves them via its own label map (see
 *  AddSourceDialog.svelte) the same way BrainDocumentsTable maps status/source
 *  constants to message functions. */
export interface ModuleSourceDef {
  key: string;
  labelKey: string;
  descriptionKey: string;
  requiredPerm: { module: Module; action: PermAction };
  render(ctx: CoreCtx): Promise<string>;
}

export const MODULE_SOURCES: Record<string, ModuleSourceDef> = {
  fin_products: {
    key: 'fin_products',
    labelKey: 'brains_source_module_fin_products_label',
    descriptionKey: 'brains_source_module_fin_products_desc',
    requiredPerm: { module: 'finance', action: 'view' },
    render: renderFinProducts,
  },
  crm_contacts: {
    key: 'crm_contacts',
    labelKey: 'brains_source_module_crm_contacts_label',
    descriptionKey: 'brains_source_module_crm_contacts_desc',
    requiredPerm: { module: 'crm', action: 'view' },
    render: renderCrmContacts,
  },
  stk_items: {
    key: 'stk_items',
    labelKey: 'brains_source_module_stk_items_label',
    descriptionKey: 'brains_source_module_stk_items_desc',
    requiredPerm: { module: 'stock', action: 'view' },
    render: renderStkItems,
  },
};

export interface ModuleSourceInfo {
  key: string;
  labelKey: string;
  descriptionKey: string;
}

/** `MODULE_SOURCES` entries the caller may add as a brain source, filtered by
 *  each entry's `requiredPerm` — the same `resolveCapabilities` primitive
 *  `hasOrgCapability` (API routes) is built on, called here with a `CoreCtx`
 *  since this runs from the service layer, not a route with `locals`. */
export async function listModuleSources(ctx: CoreCtx): Promise<ModuleSourceInfo[]> {
  if (!ctx.profileId) return [];
  const caps = await resolveCapabilities(ctx.tenantId, ctx.profileId);
  return Object.values(MODULE_SOURCES)
    .filter((s) => caps.can(s.requiredPerm.module, s.requiredPerm.action))
    .map(({ key, labelKey, descriptionKey }) => ({ key, labelKey, descriptionKey }));
}

async function renderModuleRef(ctx: CoreCtx, sourceRef: string | null): Promise<string> {
  const entry = sourceRef ? MODULE_SOURCES[sourceRef] : undefined;
  if (!entry) throw new Error(`module_ref '${sourceRef ?? ''}' is not supported`);
  return entry.render(ctx);
  // P2 hub_events hook: re-enqueue module_ref docs on relevant data-change events
  // (module data changes rarely but should still refresh periodically / on event).
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
/** Observe late fulfillment/rejection while bounding the caller by cancellation. */
function loadWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  return new Promise<T>((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(resolve, reject);
  }).finally(() => signal.removeEventListener('abort', abort));
}

async function fetchUrlContent(url: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  let current = url;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  let html: string;
  try {
    for (let hop = 0; ; hop++) {
      if (hop > URL_FETCH_MAX_REDIRECTS) throw new Error('too many redirects');
      await loadWithSignal(() => assertSafeUrl(current, 'brain document URL'), controller.signal);
      const res = await loadWithSignal(
        () => fetch(current, { redirect: 'manual', signal: controller.signal }),
        controller.signal,
      );
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('redirect without a location');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      html = (await loadWithSignal(() => res.text(), controller.signal)).slice(0, 100_000);
      break;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
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

/** Load a document's raw text for ingestion. Exported for direct unit testing
 *  (mirrors chunkText/canAccessBrain being exported for the same reason). */
export async function loadDocumentContent(
  ctx: CoreCtx,
  doc: BrainDocument,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  switch (doc.sourceType) {
    case 'note':
      return doc.contentMd ?? '';
    case 'url':
      if (!doc.sourceRef) throw new Error('url document is missing source_ref');
      return fetchUrlContent(doc.sourceRef, signal);
    case 'module_ref':
      return signal
        ? loadWithSignal(() => renderModuleRef(ctx, doc.sourceRef), signal)
        : renderModuleRef(ctx, doc.sourceRef);
    case 'upload':
      // v1: small text files read client-side (FileReader) and posted as-is —
      // content_md already holds the file's text, source_ref is the filename.
      // No server-side storage/parsing (no B2, no PDF/DOCX) — see documents
      // POST route for the size/extension validation gate.
      return doc.contentMd ?? '';
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
class BrainAlreadyPublished extends Error {}

async function advanceBrainIngest(job: BgJob, execution: JobExecution): Promise<AdvanceResult> {
  const documentId = job.refId;
  if (!documentId) return { done: true, error: 'brain_ingest job is missing refId (document id)' };
  // A pending status cannot prove which historical reset admitted an old job.
  // Explicit reingest establishes a fresh revision without executing old intent.
  const request = readJobRequest(job);
  if (!request) return { done: true, error: 'brain_ingest legacy job requires explicit reingest' };
  if (request.family !== BRAIN_INGEST_FAMILY || request.entityId !== documentId)
    throw new JobEffectError('conflict', 'Brain job request identity mismatch');
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: job.tenantId };
  let stage: 'loading' | 'embedding' | 'publishing' = 'loading';
  const assertUnpublished = async (tx: CoreTx) => {
    const current = await lockedDocument(tx, ctx.tenantId, request);
    if (current.status === 'ready') throw new BrainAlreadyPublished();
  };
  const finishPublished = async () => {
    await withJobRequest(
      execution,
      ctx,
      request,
      async (tx, current) => {
        const document = await lockedDocument(tx, ctx.tenantId, request);
        if (document.status !== 'ready')
          throw new JobEffectError('conflict', 'Brain publication no longer current');
        const saved = JSON.parse(current.cursor ?? '{}') as Record<string, unknown>;
        const prior = saved.brainIngest;
        return {
          ...saved,
          brainIngest: {
            ...(prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {}),
            phase: 'complete',
          },
        };
      },
      (saved) => saved,
    );
    return jobRequestAdvanceResult(execution, ctx, request, true);
  };
  try {
    const doc = await withJobRequest(execution, ctx, request, async (tx) => {
      const current = await lockedDocument(tx, ctx.tenantId, request);
      if (current.status !== 'ready')
        await tx
          .update(brainDocuments)
          .set({ status: 'ingesting', error: null, updatedAt: new Date() })
          .where(and(eq(brainDocuments.id, current.id), eq(brainDocuments.orgId, ctx.tenantId)));
      return current;
    });
    if (doc.status === 'ready') return finishPublished();
    const text = await loadDocumentContent(ctx, doc, execution.signal);
    execution.signal.throwIfAborted();
    const pieces = chunkText(text);
    const enabled = pieces.length > 0 && embeddingsEnabled();
    if (pieces.length > 64 * 1024) throw new Error('Brain document exceeds receipt batch limit');
    const provider = enabled
      ? (() => {
          const { endpoint, model, normalization, dimensions } = prepareEmbeddingRequest(
            pieces.slice(0, 64),
          ).descriptor;
          return { endpoint, model, normalization, dimensions };
        })()
      : null;
    const mode = pieces.length === 0 ? 'empty' : enabled ? 'embedded' : 'disabled';
    const manifest = createHash('sha256')
      .update(JSON.stringify([BRAIN_INGEST_PIPELINE, pieces, mode, provider]))
      .digest('hex');
    const progress = (phase: string, receivedBatches = 0) => ({
      brainIngest: { manifest, phase, chunks: pieces.length, receivedBatches },
    });
    // Cursor fields describe progress; only the shared head arbitrates duplicates.
    await bindJobManifest(
      execution,
      ctx,
      request,
      manifest,
      assertUnpublished,
      progress('prepared'),
    );
    const vectors: number[][] = [];
    const units: string[] = [];
    stage = 'embedding';
    if (provider)
      for (let offset = 0; offset < pieces.length; offset += 64) {
        const unit = `batch:${offset / 64}`;
        vectors.push(
          ...(await runJobEmbedding(
            execution,
            ctx,
            request,
            unit,
            pieces.slice(offset, offset + 64),
            BRAIN_INGEST_PIPELINE,
            {
              expectedManifestHash: manifest,
              expectedProvider: provider,
              validateDomain: assertUnpublished,
            },
          )),
        );
        units.push(unit);
        await withJobRequest(
          execution,
          ctx,
          request,
          assertUnpublished,
          progress('received', units.length),
          manifest,
        );
      }
    if (
      provider &&
      (vectors.length !== pieces.length || units.length !== Math.ceil(pieces.length / 64))
    )
      throw new JobEffectError('conflict', 'Brain publication requires its complete manifest');
    stage = 'publishing';
    const publish = async (tx: CoreTx) => {
      const current = await lockedDocument(tx, ctx.tenantId, request);
      if (current.status === 'ready') return;
      await tx
        .delete(brainChunks)
        .where(and(eq(brainChunks.documentId, documentId), eq(brainChunks.orgId, ctx.tenantId)));
      if (pieces.length > 0) {
        await tx.insert(brainChunks).values(
          pieces.map((chunk, i) => ({
            brainId: current.brainId,
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
        .where(and(eq(brainDocuments.id, documentId), eq(brainDocuments.orgId, ctx.tenantId)));
    };
    if (units.length)
      await commitJobEffects(
        execution,
        ctx,
        request,
        units,
        publish,
        progress('complete', units.length),
        manifest,
      );
    else await withJobRequest(execution, ctx, request, publish, progress('complete'), manifest);
    return finishPublished();
  } catch (err) {
    if (execution.signal.aborted) throw err;
    if (err instanceof BrainAlreadyPublished) return finishPublished();
    if (err instanceof JobEffectError)
      throw new JobEffectError(err.code, `brain_ingest ${err.code}: ${err.message}`);
    if (stage === 'embedding') {
      // TODO(handoff): Indeterminate admissions need an explicit recovery/UI and
      // retention policy; never replay or infer another duplicate's remote outcome.
      // See meta proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
      throw new JobEffectError('indeterminate', 'brain_ingest embedding outcome is indeterminate');
    }
    const message =
      stage === 'loading'
        ? 'brain_ingest content loading failed'
        : 'brain_ingest publication failed; received batches retained';
    const alreadyPublished = await withJobRequest(execution, ctx, request, async (tx) => {
      const current = await lockedDocument(tx, ctx.tenantId, request);
      if (current.status === 'ready') return true;
      await tx
        .update(brainDocuments)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(and(eq(brainDocuments.id, documentId), eq(brainDocuments.orgId, ctx.tenantId)));
      return false;
    });
    if (alreadyPublished) return finishPublished();
    return { ...(await jobRequestAdvanceResult(execution, ctx, request, true)), error: message };
  }
}

// TODO(handoff): JOB-02 still requires driver-recovery and deployed migration/drain
// qualification plus an explicit indeterminate-request recovery policy. Receipt-backed
// source tests do not close those gates. See meta proposals/2026-09-08-platform-qc-remediation.md.

registerJobHandler({ type: 'brain_ingest', advance: advanceBrainIngest });
