import { and, eq, inArray, ne } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { tagLinks, crmTags, crmContactTags } from '$server/db/pg-crm-schema';
import type { CalTag } from '$lib/components/scheduling/calendar/types';

/**
 * Org-wide tag application for bookings, event types (services), and catalog
 * products, sharing the `crm_tags` registry via the polymorphic `tag_links`
 * join table (spec 2026-09-08-hub-scheduling-calendar-views-tags-spec §2.2).
 * Contacts keep their own `crm_contact_tags` — `getContactTagsBulk` reads that
 * table, never `tag_links`.
 */
export type TagEntityKind = 'booking' | 'event_type' | 'product';

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
      ),
  );
  for (const r of rows) {
    const list = out.get(r.entityId) ?? [];
    list.push(toCalTag(r));
    out.set(r.entityId, list);
  }
  return out;
}

/**
 * Replace the whole tag set on one entity. Rejects tag ids that don't belong
 * to this org or are `kind='auto'` (auto-tags are contact-only, never applied
 * manually here). Returns the resulting tag set.
 */
export async function setTagLinks(
  ctx: CoreCtx,
  kind: TagEntityKind,
  id: string,
  tagIds: string[],
  appliedBy: string | null,
): Promise<CalTag[]> {
  return withOrgCore(ctx, async (tx) => {
    let valid: Array<{ id: string; name: string; color: string | null }> = [];
    if (tagIds.length) {
      valid = await tx
        .select({ id: crmTags.id, name: crmTags.name, color: crmTags.color })
        .from(crmTags)
        .where(
          and(
            eq(crmTags.orgId, ctx.tenantId),
            inArray(crmTags.id, tagIds),
            ne(crmTags.kind, 'auto'),
          ),
        );
      if (valid.length !== new Set(tagIds).size) {
        throw new Error('one or more tag ids are invalid for this org');
      }
    }
    await tx
      .delete(tagLinks)
      .where(
        and(
          eq(tagLinks.orgId, ctx.tenantId),
          eq(tagLinks.entityKind, kind),
          eq(tagLinks.entityId, id),
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
      .where(inArray(crmContactTags.contactId, contactIds)),
  );
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(toCalTag(r));
    out.set(r.contactId, list);
  }
  return out;
}
