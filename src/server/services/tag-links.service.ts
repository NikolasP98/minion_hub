import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { tagLinks, crmTags, crmContactTags } from '$server/db/pg-crm-schema';
import { stkItems, stkConsumption } from '$server/db/pg-schema/stock';
import { listAllComponentEdges } from '$server/services/stock.service';
import type { CalTag } from '$lib/components/scheduling/calendar/types';
import { TAG_SCOPE_OF_KIND, type TagEntityKind } from '$lib/tags/scope';
import { inheritedFromDescendants } from '$lib/tags/inherit';

export type { TagEntityKind } from '$lib/tags/scope';

/**
 * Org-wide tag application for bookings, event types (services), catalog
 * products and stock items, sharing the `crm_tags` registry via the
 * polymorphic `tag_links` join table (spec
 * 2026-09-08-hub-scheduling-calendar-views-tags-spec §2.2). Every tag belongs
 * to ONE scope (`crm_tags.scope`) and `setTagLinks` only accepts tags of the
 * entity kind's scope (`TAG_SCOPE_OF_KIND`). Contacts keep their own
 * `crm_contact_tags` — `getContactTagsBulk` reads that table, never `tag_links`.
 * Inheritance (recipes ← ingredients, products ← their recipe/consumption)
 * is computed at read time by `getInheritedItemTags` / `getProductIngredientTags`.
 */
function toCalTag(row: { id: string; name: string; color: string | null }): CalTag {
  return { id: row.id, name: row.name, color: row.color };
}

/** Tags applied directly to each of `ids` (via tag_links), batched. */
export async function getTagLinks(
  ctx: CoreCtx,
  kind: TagEntityKind,
  ids: string[],
): Promise<Map<string, CalTag[]>> {
  const out = new Map<string, CalTag[]>();
  if (!ids.length) return out;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        entityId: tagLinks.entityId,
        id: crmTags.id,
        name: crmTags.name,
        color: crmTags.color,
      })
      .from(tagLinks)
      .innerJoin(crmTags, eq(crmTags.id, tagLinks.tagId))
      .where(
        and(
          eq(tagLinks.orgId, ctx.tenantId),
          eq(tagLinks.entityKind, kind),
          inArray(tagLinks.entityId, ids),
        ),
      )
      .orderBy(asc(crmTags.position), asc(crmTags.name)),
  );
  for (const r of rows) {
    const list = out.get(r.entityId) ?? [];
    list.push(toCalTag(r));
    out.set(r.entityId, list);
  }
  return out;
}

/**
 * Replace the manual tag set on one entity. Rejects tag ids that don't belong
 * to this org, are non-manual (classifiers cannot be applied by this editor),
 * or live in another scope than the entity kind's — a stock
 * tag can never land on a product, nor a customer tag on an event. Returns the
 * resulting manual tag set. Preserve legacy read-only links: displaying one
 * must not make it editable or silently delete it when a manual tag changes.
 */
export async function setTagLinks(
  ctx: CoreCtx,
  kind: TagEntityKind,
  id: string,
  tagIds: string[],
  appliedBy: string | null,
): Promise<CalTag[]> {
  const scope = TAG_SCOPE_OF_KIND[kind];
  return withOrgCore(ctx, async (tx) => {
    // Two whole-set replacements must not interleave their delete/insert
    // phases. The lock is transaction-local and isolated by org and entity.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
      ${JSON.stringify(['tag-links', ctx.tenantId, kind, id])}, 0))`);
    let valid: Array<{ id: string; name: string; color: string | null }> = [];
    if (tagIds.length) {
      valid = await tx
        .select({ id: crmTags.id, name: crmTags.name, color: crmTags.color })
        .from(crmTags)
        .where(
          and(
            eq(crmTags.orgId, ctx.tenantId),
            inArray(crmTags.id, tagIds),
            eq(crmTags.kind, 'manual'),
            eq(crmTags.scope, scope),
          ),
        );
      if (valid.length !== new Set(tagIds).size) {
        throw new Error(`one or more tag ids are invalid for this org (must be ${scope} tags)`);
      }
    }
    await tx.delete(tagLinks).where(
      and(
        eq(tagLinks.orgId, ctx.tenantId),
        eq(tagLinks.entityKind, kind),
        eq(tagLinks.entityId, id),
        inArray(
          tagLinks.tagId,
          tx
            .select({ id: crmTags.id })
            .from(crmTags)
            .where(
              and(
                eq(crmTags.orgId, ctx.tenantId),
                eq(crmTags.scope, scope),
                eq(crmTags.kind, 'manual'),
              ),
            ),
        ),
      ),
    );
    if (valid.length) {
      await tx.insert(tagLinks).values(
        valid.map((t) => ({
          orgId: ctx.tenantId,
          entityKind: kind,
          entityId: id,
          tagId: t.id,
          appliedBy,
        })),
      );
    }
    return valid.map(toCalTag);
  });
}

/** Manual tags of each contact in `contactIds` (crm_contact_tags ⋈ crm_tags), batched. */
export async function getContactTagsBulk(
  ctx: CoreCtx,
  contactIds: string[],
): Promise<Map<string, CalTag[]>> {
  const out = new Map<string, CalTag[]>();
  if (!contactIds.length) return out;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        contactId: crmContactTags.contactId,
        id: crmTags.id,
        name: crmTags.name,
        color: crmTags.color,
      })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(inArray(crmContactTags.contactId, contactIds))
      .orderBy(asc(crmTags.position), asc(crmTags.name)),
  );
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(toCalTag(r));
    out.set(r.contactId, list);
  }
  return out;
}

export interface ItemTags {
  /** Applied to the item itself (`tag_links` kind `item`). */
  own: CalTag[];
  /** Union of every descendant ingredient's own tags (recipes inherit). */
  inherited: CalTag[];
}

/**
 * Own + inherited stock tags for each item. Inheritance walks the composition
 * DAG (`stk_item_components`): a recipe carries every tag of every ingredient
 * below it. Descendants are resolved from the whole org graph in one read.
 */
export async function getInheritedItemTags(
  ctx: CoreCtx,
  itemIds: string[],
): Promise<Map<string, ItemTags>> {
  const out = new Map<string, ItemTags>();
  if (!itemIds.length) return out;
  const edges = await listAllComponentEdges(ctx);
  const involved = new Set(itemIds);
  for (const e of edges) {
    involved.add(e.parentItemId);
    involved.add(e.childItemId);
  }
  const own = await getTagLinks(ctx, 'item', [...involved]);
  const inherited = inheritedFromDescendants(edges, itemIds, own);
  for (const id of itemIds) {
    out.set(id, { own: own.get(id) ?? [], inherited: inherited.get(id) ?? [] });
  }
  return out;
}

/**
 * Stock tags a catalog product inherits from its ingredients: the recipe
 * behind it (`stk_items.fin_product_id` bridge → its descendants) plus the
 * items it consumes directly (`stk_consumption`). The bridge item's OWN tags
 * are not "ingredients" and are left out.
 */
export async function getProductIngredientTags(
  ctx: CoreCtx,
  productIds: string[],
): Promise<Map<string, CalTag[]>> {
  const out = new Map<string, CalTag[]>();
  if (!productIds.length) return out;
  const [bridges, consumption, edges] = await Promise.all([
    withOrgCore(ctx, (tx) =>
      tx
        .select({ productId: stkItems.finProductId, itemId: stkItems.id })
        .from(stkItems)
        .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.finProductId, productIds))),
    ),
    withOrgCore(ctx, (tx) =>
      tx
        .select({ productId: stkConsumption.finProductId, itemId: stkConsumption.itemId })
        .from(stkConsumption)
        .where(
          and(
            eq(stkConsumption.orgId, ctx.tenantId),
            inArray(stkConsumption.finProductId, productIds),
          ),
        ),
    ),
    listAllComponentEdges(ctx),
  ]);
  const bridgeOf = new Map<string, string>();
  for (const b of bridges) if (b.productId) bridgeOf.set(b.productId, b.itemId);
  const consumed = new Map<string, string[]>();
  for (const c of consumption) {
    if (!c.productId) continue;
    const list = consumed.get(c.productId) ?? [];
    list.push(c.itemId);
    consumed.set(c.productId, list);
  }
  const involved = new Set<string>();
  for (const e of edges) {
    involved.add(e.parentItemId);
    involved.add(e.childItemId);
  }
  for (const ids of consumed.values()) for (const id of ids) involved.add(id);
  if (!involved.size) return out;
  const own = await getTagLinks(ctx, 'item', [...involved]);
  // Roots are the bridge items (recipes); products without a recipe use a
  // synthetic root so their consumed items still count as ingredients.
  const rootOf = (p: string) => bridgeOf.get(p) ?? `product:${p}`;
  const roots = productIds.map(rootOf);
  const extra = new Map(productIds.map((p) => [rootOf(p), consumed.get(p) ?? []]));
  const inherited = inheritedFromDescendants(edges, roots, own, extra);
  for (const p of productIds) out.set(p, inherited.get(rootOf(p)) ?? []);
  return out;
}
