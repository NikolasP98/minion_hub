import { and, eq, inArray } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedLinks, schedEventTypes } from '$server/db/pg-scheduling-schema';
import type { SchedEventType } from '$server/db/pg-scheduling-schema';
import { getSlotsForEventType } from './scheduling-slots.service';
import { createBooking } from './scheduling-bookings.service';
import type { SchedBooking } from '$server/db/pg-scheduling-schema';
import { isModuleEnabled } from './modules.service';

/**
 * Public (unauthenticated) booking flow for /book/[slug].
 *
 * SECURITY BOUNDARY: there is no user session, so we resolve the owning org from
 * the link slug using a bypass-RLS read (getCoreDb runs as the rolbypassrls
 * `postgres` role). That single lookup reads only (slug → org_id). Every
 * subsequent read/write is routed through a CoreCtx for the resolved org, so the
 * forced per-table RLS policies still isolate it exactly like an authenticated
 * request — the slug only ever selects WHICH org, never grants cross-org access.
 *
 * Link slugs are unique per-org (not globally). For a single-org deployment this
 * is unambiguous; multi-org public hosting should namespace the slug (roadmap
 * R11). When multiple orgs share a slug we deterministically pick the oldest.
 */

export interface PublicLinkData {
  ctx: CoreCtx;
  link: { id: string; slug: string; title: string; description: string | null; resourceId: string | null };
  eventTypes: SchedEventType[];
}

/** Resolve a public scheduling link by slug → org-scoped ctx + its public event types. */
export async function resolvePublicLink(slug: string): Promise<PublicLinkData | null> {
  const db = getCoreDb();
  // Bypass-RLS lookup: slug → org. Active, unexpired links only.
  const matches = await db
    .select({
      id: schedLinks.id,
      orgId: schedLinks.orgId,
      slug: schedLinks.slug,
      title: schedLinks.title,
      description: schedLinks.description,
      eventTypeIds: schedLinks.eventTypeIds,
      resourceId: schedLinks.resourceId,
      active: schedLinks.active,
      expiresAt: schedLinks.expiresAt,
    })
    .from(schedLinks)
    .where(eq(schedLinks.slug, slug));
  const now = Date.now();
  const link = matches
    .filter((l) => l.active && (!l.expiresAt || l.expiresAt.getTime() > now))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!link) return null;

  const ctx: CoreCtx = { db, tenantId: link.orgId };
  if (!(await isModuleEnabled(ctx, 'scheduling'))) return null;

  // Org-scoped (RLS-enforced) read of the link's public, active event types.
  const eventTypes = link.eventTypeIds.length
    ? await withOrgCore(ctx, (tx) =>
        tx
          .select()
          .from(schedEventTypes)
          .where(
            and(
              eq(schedEventTypes.orgId, link.orgId),
              inArray(schedEventTypes.id, link.eventTypeIds),
              eq(schedEventTypes.active, true),
              eq(schedEventTypes.public, true),
            ),
          ),
      )
    : [];

  return {
    ctx,
    link: { id: link.id, slug: link.slug, title: link.title, description: link.description, resourceId: link.resourceId },
    eventTypes,
  };
}

/** Public slot lookup for one event type behind a link. */
export async function publicSlots(slug: string, eventTypeId: string, from: Date, to: Date) {
  const resolved = await resolvePublicLink(slug);
  if (!resolved) return null;
  // The event type must belong to this link.
  if (!resolved.eventTypes.some((e) => e.id === eventTypeId)) return null;
  const result = await getSlotsForEventType(resolved.ctx, eventTypeId, from, to, {
    pinnedResourceId: resolved.link.resourceId,
  });
  if (!result) return null;
  return result.slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }));
}

export interface PublicBookInput {
  eventTypeId: string;
  start: string; // ISO
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

/** Public booking creation behind a link. Returns the booking or null if invalid. */
export async function publicBook(slug: string, input: PublicBookInput): Promise<SchedBooking | null> {
  const resolved = await resolvePublicLink(slug);
  if (!resolved) return null;
  if (!resolved.eventTypes.some((e) => e.id === input.eventTypeId)) return null;
  return createBooking(resolved.ctx, {
    eventTypeId: input.eventTypeId,
    start: new Date(input.start),
    attendeeName: input.name,
    attendeeEmail: input.email ?? null,
    attendeePhone: input.phone ?? null,
    notes: input.notes ?? null,
    source: 'public_link',
    preferredResourceId: resolved.link.resourceId,
  });
}
