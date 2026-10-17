import { nextWriteTimestamp } from './errors';
import { and, eq } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProductComponents, finProducts } from '$server/db/pg-finance-schema';
import {
  schedEventTypes,
  schedEventTypeResources,
  schedResources,
} from '$server/db/pg-scheduling-schema';
import { isModuleEnabled } from './modules.service';

/**
 * Keeps `sched_event_types` in lock-step with the catalog (spec
 * 2026-10-10-hub-catalog-service-unification §Slice 3, invariant I3): every
 * active catalog SERVICE has exactly one scheduling row, named and gated by
 * the product. Kept in its own module — not inlined into pos.service.ts — so
 * Slice 1/2's concurrent edits to that file never collide with this one;
 * createSellable/updateSellable each gain exactly ONE call into
 * `syncEventTypeForSellable`.
 *
 * Every exported function opens its own `withOrgCore` transaction (ctx-level,
 * sequential — `withOrgCore` does not nest, same convention
 * createSellable already follows for its product→item→consumption writes).
 * A sync failure never rolls back the catalog write that already committed;
 * re-running the same save (or any later save) heals it, since every save
 * calls this unconditionally.
 */

export interface SyncableProduct {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Creates the scheduling row for a catalog service that has none yet.
 * `title`/`active` come from the product; `length`/`kindId`/assignee set
 * come from the org's own configuration template (spec: "the configuration
 * shared by the most active rows in the org") rather than a hardcoded
 * guess — see `resolveOrgTemplate`. No-op when the org already has a row
 * for this product (I3: at most one row per product, ever).
 */
export async function ensureEventTypeForService(
  ctx: CoreCtx,
  product: SyncableProduct,
): Promise<void> {
  if (!(await isModuleEnabled(ctx, 'scheduling'))) return;
  await withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: schedEventTypes.id })
      .from(schedEventTypes)
      .where(
        and(eq(schedEventTypes.orgId, ctx.tenantId), eq(schedEventTypes.productId, product.id)),
      )
      .limit(1);
    if (existing) return;

    const template = await resolveOrgTemplate(tx, ctx.tenantId);
    const slug = await uniqueSlug(tx, ctx.tenantId, product.name);
    const [row] = await tx
      .insert(schedEventTypes)
      .values({
        orgId: ctx.tenantId,
        slug,
        title: product.name,
        length: template.length,
        kindId: template.kindId,
        productId: product.id,
        active: product.active,
      })
      .returning({ id: schedEventTypes.id });
    if (template.resourceIds.length) {
      await tx.insert(schedEventTypeResources).values(
        template.resourceIds.map((resourceId) => ({
          orgId: ctx.tenantId,
          eventTypeId: row.id,
          resourceId,
        })),
      );
    }
  });
}

/**
 * Write-through for an existing catalog↔scheduling link (spec D5): a
 * service's `title`/`active` always follow the product. A kind flip AWAY
 * from service deactivates the row instead of deleting it (I3: "a retired
 * service's row is inactive"). A flip BACK onto service calls
 * `ensureEventTypeForService`, which also covers the defensive case where no
 * row exists yet at all (a service created before this slice shipped).
 */
export async function syncEventTypeFromProduct(
  ctx: CoreCtx,
  product: SyncableProduct & { kind: 'service' | 'product' },
): Promise<void> {
  if (!(await isModuleEnabled(ctx, 'scheduling'))) return;

  if (product.kind === 'product') {
    await withOrgCore(ctx, (tx) =>
      tx
        .update(schedEventTypes)
        .set({ active: false, updatedAt: nextWriteTimestamp(schedEventTypes.updatedAt) })
        .where(
          and(
            eq(schedEventTypes.orgId, ctx.tenantId),
            eq(schedEventTypes.productId, product.id),
            eq(schedEventTypes.active, true),
          ),
        ),
    );
    return;
  }

  const [existing] = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        id: schedEventTypes.id,
        title: schedEventTypes.title,
        active: schedEventTypes.active,
      })
      .from(schedEventTypes)
      .where(
        and(eq(schedEventTypes.orgId, ctx.tenantId), eq(schedEventTypes.productId, product.id)),
      )
      .limit(1),
  );
  if (!existing) {
    await ensureEventTypeForService(ctx, product);
    return;
  }
  if (existing.title === product.name && existing.active === product.active) return;
  await withOrgCore(ctx, (tx) =>
    tx
      .update(schedEventTypes)
      .set({
        title: product.name,
        active: product.active,
        updatedAt: nextWriteTimestamp(schedEventTypes.updatedAt),
      })
      .where(
        and(eq(schedEventTypes.orgId, ctx.tenantId), eq(schedEventTypes.productId, product.id)),
      ),
  );
}

/**
 * The ONE call site `pos.service.ts`'s createSellable/updateSellable add.
 * Schedulable = stored `kind = 'service'` (Slice 1) AND not a package: a
 * package (a service with service components) is rung up at the till and its
 * SESSIONS are booked as the child services, so it never gets a scheduling row
 * of its own. Anything not schedulable takes the deactivate path.
 */
export async function syncEventTypeForSellable(ctx: CoreCtx, productId: string): Promise<void> {
  const facts = await withOrgCore(ctx, async (tx) => {
    const [product] = await tx
      .select({
        id: finProducts.id,
        name: finProducts.name,
        active: finProducts.active,
        kind: finProducts.kind,
      })
      .from(finProducts)
      .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)))
      .limit(1);
    if (!product) return null;
    const [component] = await tx
      .select({ id: finProductComponents.id })
      .from(finProductComponents)
      .where(
        and(
          eq(finProductComponents.bundleProductId, productId),
          eq(finProductComponents.orgId, ctx.tenantId),
        ),
      )
      .limit(1);
    const schedulable = product.kind === 'service' && !component;
    return { ...product, kind: schedulable ? ('service' as const) : ('product' as const) };
  });
  if (!facts) return; // the product write raced a delete — nothing to sync
  await syncEventTypeFromProduct(ctx, facts);
}

// ── org configuration template (spec D4: "scheduling row from org template") ──

export interface OrgTemplate {
  length: number;
  kindId: string | null;
  resourceIds: string[];
}

export interface TemplateRow {
  id: string;
  length: number;
  kindId: string | null;
  createdAt: Date;
}

export const FALLBACK_LENGTH_MINUTES = 30;

/**
 * Pure selection logic for `resolveOrgTemplate`, split out so it is directly
 * unit-testable without a database: "the configuration shared by the most
 * active rows in the org" (spec) — groups `activeRows` by their (length,
 * kindId, resource-set) signature and returns the most common one. An org
 * with no active rows yet gets the spec's explicit empty-org fallback: 30
 * minutes, no default kind, every active resource (`fallbackResourceIds`).
 */
export function computeOrgTemplate(
  activeRows: readonly TemplateRow[],
  resourceIdsByType: ReadonlyMap<string, readonly string[]>,
  fallbackResourceIds: readonly string[],
): OrgTemplate {
  if (!activeRows.length) {
    return { length: FALLBACK_LENGTH_MINUTES, kindId: null, resourceIds: [...fallbackResourceIds] };
  }

  // Stable order: oldest row first, so a frequency tie always resolves to
  // the longest-standing configuration rather than whichever row the DB
  // happened to return last.
  const ordered = [...activeRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sigOf = (row: TemplateRow) =>
    `${row.length}|${row.kindId ?? ''}|${(resourceIdsByType.get(row.id) ?? []).slice().sort().join(',')}`;
  const counts = new Map<string, number>();
  for (const row of ordered) {
    const sig = sigOf(row);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }

  let winner = ordered[0];
  let winnerCount = counts.get(sigOf(winner)) ?? 0;
  for (const row of ordered) {
    const c = counts.get(sigOf(row)) ?? 0;
    if (c > winnerCount) {
      winner = row;
      winnerCount = c;
    }
  }
  return {
    length: winner.length,
    kindId: winner.kindId,
    resourceIds: [...(resourceIdsByType.get(winner.id) ?? [])],
  };
}

/** DB-touching wrapper around `computeOrgTemplate`. Runs inside the CALLER's
 *  open transaction — never opens its own (`withOrgCore` does not nest). */
async function resolveOrgTemplate(tx: CoreTx, orgId: string): Promise<OrgTemplate> {
  const active = await tx
    .select({
      id: schedEventTypes.id,
      length: schedEventTypes.length,
      kindId: schedEventTypes.kindId,
      createdAt: schedEventTypes.createdAt,
    })
    .from(schedEventTypes)
    .where(and(eq(schedEventTypes.orgId, orgId), eq(schedEventTypes.active, true)));

  if (!active.length) {
    const resources = await tx
      .select({ id: schedResources.id })
      .from(schedResources)
      .where(and(eq(schedResources.orgId, orgId), eq(schedResources.active, true)));
    return computeOrgTemplate(
      [],
      new Map(),
      resources.map((r) => r.id),
    );
  }

  const links = await tx
    .select({
      eventTypeId: schedEventTypeResources.eventTypeId,
      resourceId: schedEventTypeResources.resourceId,
    })
    .from(schedEventTypeResources)
    .where(eq(schedEventTypeResources.orgId, orgId));
  const byType = new Map<string, string[]>();
  for (const l of links) {
    const list = byType.get(l.eventTypeId) ?? [];
    list.push(l.resourceId);
    byType.set(l.eventTypeId, list);
  }
  return computeOrgTemplate(active, byType, []);
}

// ── slug ─────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Pure suffix search, split out for direct unit testing. */
export function nextAvailableSlug(base: string, taken: ReadonlySet<string>): string {
  const safeBase = base || 'service';
  if (!taken.has(safeBase)) return safeBase;
  for (let n = 2; ; n++) {
    const candidate = `${safeBase}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Org-unique slug (`sched_event_types_org_slug_uniq`) — mirrors
 *  `EventTypeEditor`'s own client-side slugify so a catalog-created row's
 *  slug looks the same as a hand-typed one. */
async function uniqueSlug(tx: CoreTx, orgId: string, name: string): Promise<string> {
  const base = slugify(name);
  const existing = await tx
    .select({ slug: schedEventTypes.slug })
    .from(schedEventTypes)
    .where(eq(schedEventTypes.orgId, orgId));
  return nextAvailableSlug(base, new Set(existing.map((r) => r.slug)));
}
