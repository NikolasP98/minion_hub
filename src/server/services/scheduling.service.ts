import { and, eq, asc, inArray } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  schedResources,
  schedSchedules,
  schedAvailability,
  schedEventKinds,
  schedEventTypes,
  schedEventTypeResources,
  schedLinks,
} from '$server/db/pg-scheduling-schema';
import type {
  SchedResource,
  SchedEventType,
  SchedAvailability,
  SchedLink,
} from '$server/db/pg-scheduling-schema';
import type { CalKind } from '$lib/components/scheduling/calendar/types';

/**
 * Data access for the scheduling module's configuration entities: resources
 * (staff), their availability schedules, event types, and shareable links.
 * Booking creation + slot computation live in their own services. Every query
 * routes through withOrgCore so RLS forces org isolation.
 */

// ── Resources ────────────────────────────────────────────────────────────────

export function listResources(ctx: CoreCtx): Promise<SchedResource[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(schedResources)
      .where(eq(schedResources.orgId, ctx.tenantId))
      .orderBy(asc(schedResources.name)),
  );
}

export interface ResourceInput {
  name: string;
  kind?: string;
  profileId?: string | null;
  email?: string | null;
  timezone?: string;
  color?: string | null;
  active?: boolean;
}

export async function createResource(ctx: CoreCtx, input: ResourceInput): Promise<SchedResource> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(schedResources)
      .values({
        orgId: ctx.tenantId,
        name: input.name,
        kind: input.kind ?? 'staff',
        profileId: input.profileId ?? null,
        email: input.email ?? null,
        timezone: input.timezone ?? 'America/Lima',
        color: input.color ?? null,
        active: input.active ?? true,
      })
      .returning();
    // Seed a default Mon–Fri 09:00–17:00 schedule so the resource is immediately bookable.
    const [sched] = await tx
      .insert(schedSchedules)
      .values({ orgId: ctx.tenantId, resourceId: row.id, timezone: row.timezone, isDefault: true })
      .returning();
    await tx.insert(schedAvailability).values({
      orgId: ctx.tenantId,
      scheduleId: sched.id,
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
      date: null,
    });
    return row;
  });
}

export async function updateResource(
  ctx: CoreCtx,
  id: string,
  patch: Partial<ResourceInput>,
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(schedResources)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.profileId !== undefined ? { profileId: patch.profileId } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schedResources.id, id), eq(schedResources.orgId, ctx.tenantId))),
  );
}

export async function deleteResource(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(schedResources)
      .where(and(eq(schedResources.id, id), eq(schedResources.orgId, ctx.tenantId))),
  );
}

// ── Availability ─────────────────────────────────────────────────────────────

export interface ResourceSchedule {
  scheduleId: string;
  timezone: string;
  rules: SchedAvailability[];
}

/** The default schedule (+ its availability rows) for a resource, if any. */
export async function getResourceSchedule(
  ctx: CoreCtx,
  resourceId: string,
): Promise<ResourceSchedule | null> {
  return withOrgCore(ctx, async (tx) => {
    const [sched] = await tx
      .select()
      .from(schedSchedules)
      .where(and(eq(schedSchedules.resourceId, resourceId), eq(schedSchedules.orgId, ctx.tenantId)))
      .orderBy(asc(schedSchedules.createdAt))
      .limit(1);
    if (!sched) return null;
    const rules = await tx
      .select()
      .from(schedAvailability)
      .where(eq(schedAvailability.scheduleId, sched.id));
    return { scheduleId: sched.id, timezone: sched.timezone, rules };
  });
}

export interface AvailabilityRuleInput {
  days: number[];
  startTime: string;
  endTime: string;
  date?: string | null;
}

/** Replace the whole rule set for a schedule (the editor saves the full list). */
export async function replaceAvailability(
  ctx: CoreCtx,
  scheduleId: string,
  timezone: string,
  rules: AvailabilityRuleInput[],
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    // Ownership guard: the schedule must belong to this org.
    const [sched] = await tx
      .select({ id: schedSchedules.id })
      .from(schedSchedules)
      .where(and(eq(schedSchedules.id, scheduleId), eq(schedSchedules.orgId, ctx.tenantId)))
      .limit(1);
    if (!sched) throw new Error('schedule not found');
    await tx
      .update(schedSchedules)
      .set({ timezone, updatedAt: new Date() })
      .where(eq(schedSchedules.id, scheduleId));
    await tx.delete(schedAvailability).where(eq(schedAvailability.scheduleId, scheduleId));
    if (rules.length) {
      await tx.insert(schedAvailability).values(
        rules.map((r) => ({
          orgId: ctx.tenantId,
          scheduleId,
          days: r.days,
          startTime: r.startTime,
          endTime: r.endTime,
          date: r.date ?? null,
        })),
      );
    }
  });
}

// ── Event kinds ──────────────────────────────────────────────────────────────
// Org-defined category on every calendar entry (booking or event type) — spec
// 2026-09-08-hub-scheduling-calendar-views-tags-spec §1/§2.1. Independent from
// event types (bookable services), which each carry a default kind via kindId.

const DEFAULT_KINDS: ReadonlyArray<{ name: string; color: string; isDefault: boolean }> = [
  { name: 'Appointment', color: '#3b82f6', isDefault: true },
  { name: 'Block', color: '#6b7280', isDefault: false },
  { name: 'Meeting', color: '#a855f7', isDefault: false },
  { name: 'Internal', color: '#f59e0b', isDefault: false },
];

function toCalKind(row: {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  position: number;
}): CalKind {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault,
    position: row.position,
  };
}

/** Ordered by position, name; lazily seeds the four default kinds when the org has none.
 * ponytail: two concurrent first-calls can both see empty and both insert — the second
 * transaction fails on the (org_id,name) unique index instead of silently duplicating.
 * Acceptable for a one-time per-org seed; add an advisory lock if it proves noisy. */
export async function listEventKinds(ctx: CoreCtx): Promise<CalKind[]> {
  return withOrgCore(ctx, async (tx) => {
    let rows = await tx
      .select()
      .from(schedEventKinds)
      .where(eq(schedEventKinds.orgId, ctx.tenantId))
      .orderBy(asc(schedEventKinds.position), asc(schedEventKinds.name));
    if (!rows.length) {
      rows = await tx
        .insert(schedEventKinds)
        .values(
          DEFAULT_KINDS.map((k, i) => ({
            orgId: ctx.tenantId,
            name: k.name,
            color: k.color,
            position: i,
            isDefault: k.isDefault,
          })),
        )
        .returning();
      rows.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return rows.map(toCalKind);
  });
}

export interface EventKindInput {
  name: string;
  color: string;
}

export async function createEventKind(ctx: CoreCtx, input: EventKindInput): Promise<CalKind> {
  const row = await withOrgCore(ctx, async (tx) => {
    const existing = await tx
      .select({ position: schedEventKinds.position })
      .from(schedEventKinds)
      .where(eq(schedEventKinds.orgId, ctx.tenantId));
    const nextPosition = existing.length ? Math.max(...existing.map((k) => k.position)) + 1 : 0;
    const [r] = await tx
      .insert(schedEventKinds)
      .values({
        orgId: ctx.tenantId,
        name: input.name,
        color: input.color,
        position: nextPosition,
      })
      .returning();
    return r;
  });
  return toCalKind(row);
}

export interface EventKindPatch {
  name?: string;
  color?: string;
  position?: number;
  isDefault?: boolean;
  active?: boolean;
}

export async function updateEventKind(
  ctx: CoreCtx,
  id: string,
  patch: EventKindPatch,
): Promise<CalKind> {
  const row = await withOrgCore(ctx, async (tx) => {
    if (patch.isDefault === true) {
      // Clear the previous default in the same transaction — the partial unique
      // index on (org_id) where is_default forbids two defaults at once.
      await tx
        .update(schedEventKinds)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(schedEventKinds.orgId, ctx.tenantId), eq(schedEventKinds.isDefault, true)));
    }
    const [r] = await tx
      .update(schedEventKinds)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schedEventKinds.id, id), eq(schedEventKinds.orgId, ctx.tenantId)))
      .returning();
    if (!r) throw new Error('event kind not found');
    return r;
  });
  return toCalKind(row);
}

export class DefaultKindDeleteError extends Error {
  constructor() {
    super('cannot delete the default event kind');
    this.name = 'DefaultKindDeleteError';
  }
}

/** FK `on delete set null` on sched_bookings/sched_event_types handles references. */
export async function deleteEventKind(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ isDefault: schedEventKinds.isDefault })
      .from(schedEventKinds)
      .where(and(eq(schedEventKinds.id, id), eq(schedEventKinds.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) return; // idempotent delete of a missing/foreign id
    if (row.isDefault) throw new DefaultKindDeleteError();
    await tx
      .delete(schedEventKinds)
      .where(and(eq(schedEventKinds.id, id), eq(schedEventKinds.orgId, ctx.tenantId)));
  });
}

/** Validate a kindId belongs to this org, inside an already-open tx — used by
 *  createBooking/upsertEventType so a stale/foreign kind id never lands on a row. */
export async function assertOrgEventKind(tx: CoreTx, orgId: string, kindId: string): Promise<void> {
  const [hit] = await tx
    .select({ id: schedEventKinds.id })
    .from(schedEventKinds)
    .where(and(eq(schedEventKinds.id, kindId), eq(schedEventKinds.orgId, orgId)))
    .limit(1);
  if (!hit) throw new Error('invalid kindId');
}

// ── Event types ──────────────────────────────────────────────────────────────

export interface EventTypeWithResources extends SchedEventType {
  resourceIds: string[];
}

export function listEventTypes(ctx: CoreCtx): Promise<EventTypeWithResources[]> {
  return withOrgCore(ctx, async (tx) => {
    const types = await tx
      .select()
      .from(schedEventTypes)
      .where(eq(schedEventTypes.orgId, ctx.tenantId))
      .orderBy(asc(schedEventTypes.title));
    if (!types.length) return [];
    const links = await tx
      .select()
      .from(schedEventTypeResources)
      .where(
        and(
          eq(schedEventTypeResources.orgId, ctx.tenantId),
          inArray(
            schedEventTypeResources.eventTypeId,
            types.map((t) => t.id),
          ),
        ),
      );
    const byType = new Map<string, string[]>();
    for (const l of links) {
      const list = byType.get(l.eventTypeId) ?? [];
      list.push(l.resourceId);
      byType.set(l.eventTypeId, list);
    }
    return types.map((t) => ({ ...t, resourceIds: byType.get(t.id) ?? [] }));
  });
}

export async function getEventType(
  ctx: CoreCtx,
  id: string,
): Promise<EventTypeWithResources | null> {
  return withOrgCore(ctx, async (tx) => {
    const [t] = await tx
      .select()
      .from(schedEventTypes)
      .where(and(eq(schedEventTypes.id, id), eq(schedEventTypes.orgId, ctx.tenantId)))
      .limit(1);
    if (!t) return null;
    const links = await tx
      .select({ resourceId: schedEventTypeResources.resourceId })
      .from(schedEventTypeResources)
      .where(eq(schedEventTypeResources.eventTypeId, id));
    return { ...t, resourceIds: links.map((l) => l.resourceId) };
  });
}

/** Normalize the per-service weekly windows payload → {days,startTime,endTime}[]. */
export function parseScheduleRules(
  raw: unknown,
): Array<{ days: number[]; startTime: string; endTime: string }> {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter((r) => Array.isArray(r.days) && r.startTime && r.endTime)
    .map((r) => ({
      days: (r.days as unknown[]).map(Number),
      startTime: String(r.startTime),
      endTime: String(r.endTime),
    }));
}

export interface EventTypeInput {
  slug: string;
  title: string;
  description?: string | null;
  length: number;
  slotInterval?: number | null;
  beforeBuffer?: number;
  afterBuffer?: number;
  minimumBookingNotice?: number;
  periodType?: string;
  periodDays?: number | null;
  schedulingType?: string | null;
  useCustomSchedule?: boolean;
  scheduleRules?: Array<{ days: number[]; startTime: string; endTime: string }>;
  requiresConfirmation?: boolean;
  public?: boolean;
  color?: string | null;
  productId?: string | null;
  /** Default event kind for bookings of this service (spec §1/§2.1). Validated
   *  as an org kind when set; undefined leaves the column untouched on update. */
  kindId?: string | null;
  active?: boolean;
  resourceIds: string[];
}

export async function upsertEventType(
  ctx: CoreCtx,
  input: EventTypeInput,
  id?: string,
): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    if (input.kindId) await assertOrgEventKind(tx, ctx.tenantId, input.kindId);
    const values = {
      orgId: ctx.tenantId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      length: input.length,
      slotInterval: input.slotInterval ?? null,
      beforeBuffer: input.beforeBuffer ?? 0,
      afterBuffer: input.afterBuffer ?? 0,
      minimumBookingNotice: input.minimumBookingNotice ?? 120,
      periodType: input.periodType ?? 'rolling',
      periodDays: input.periodDays ?? null,
      schedulingType: input.schedulingType ?? null,
      useCustomSchedule: input.useCustomSchedule ?? false,
      scheduleRules: input.scheduleRules ?? [],
      requiresConfirmation: input.requiresConfirmation ?? false,
      public: input.public ?? true,
      color: input.color ?? null,
      productId: input.productId ?? null,
      kindId: input.kindId ?? null,
      active: input.active ?? true,
      updatedAt: new Date(),
    };
    let eventTypeId = id;
    if (id) {
      await tx
        .update(schedEventTypes)
        .set(values)
        .where(and(eq(schedEventTypes.id, id), eq(schedEventTypes.orgId, ctx.tenantId)));
    } else {
      const [row] = await tx
        .insert(schedEventTypes)
        .values(values)
        .returning({ id: schedEventTypes.id });
      eventTypeId = row.id;
    }
    if (!eventTypeId) throw new Error('event type upsert failed');
    // Sync the M:N resource assignment.
    await tx
      .delete(schedEventTypeResources)
      .where(eq(schedEventTypeResources.eventTypeId, eventTypeId));
    if (input.resourceIds.length) {
      await tx.insert(schedEventTypeResources).values(
        input.resourceIds.map((resourceId) => ({
          orgId: ctx.tenantId,
          eventTypeId: eventTypeId!,
          resourceId,
        })),
      );
    }
    return eventTypeId;
  });
}

export async function deleteEventType(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(schedEventTypes)
      .where(and(eq(schedEventTypes.id, id), eq(schedEventTypes.orgId, ctx.tenantId))),
  );
}

// ── Links ────────────────────────────────────────────────────────────────────

export function listLinks(ctx: CoreCtx): Promise<SchedLink[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(schedLinks)
      .where(eq(schedLinks.orgId, ctx.tenantId))
      .orderBy(asc(schedLinks.title)),
  );
}

export interface LinkInput {
  slug: string;
  title: string;
  description?: string | null;
  eventTypeIds: string[];
  resourceId?: string | null;
  active?: boolean;
  expiresAt?: Date | null;
}

export async function upsertLink(ctx: CoreCtx, input: LinkInput, id?: string): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    const values = {
      orgId: ctx.tenantId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      eventTypeIds: input.eventTypeIds,
      resourceId: input.resourceId ?? null,
      active: input.active ?? true,
      expiresAt: input.expiresAt ?? null,
      updatedAt: new Date(),
    };
    if (id) {
      await tx
        .update(schedLinks)
        .set(values)
        .where(and(eq(schedLinks.id, id), eq(schedLinks.orgId, ctx.tenantId)));
      return id;
    }
    const [row] = await tx.insert(schedLinks).values(values).returning({ id: schedLinks.id });
    return row.id;
  });
}

export async function deleteLink(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.delete(schedLinks).where(and(eq(schedLinks.id, id), eq(schedLinks.orgId, ctx.tenantId))),
  );
}
