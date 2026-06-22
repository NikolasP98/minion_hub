import { and, eq, inArray, gte, lte, ne } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  schedResources,
  schedSchedules,
  schedAvailability,
  schedEventTypes,
  schedEventTypeResources,
  schedBookings,
} from '$server/db/pg-scheduling-schema';
import { computeSlots } from '$server/scheduling/slots';
import type { ResourceAvailability, BusyInterval, Slot, SlotEventType, AvailabilityRule } from '$server/scheduling/slots';

/**
 * Bridges the DB to the pure slot engine: loads the candidate resources'
 * availability + existing bookings for an event type over a window, then calls
 * computeSlots. Shared by the internal calendar and the public /book flow.
 */

/** The service's own weekly windows when it opts into a custom schedule, else
 *  undefined (inherit team availability). Normalizes the jsonb to AvailabilityRule. */
export function serviceRulesOf(et: { useCustomSchedule?: boolean; scheduleRules?: unknown }): AvailabilityRule[] | undefined {
  if (!et.useCustomSchedule) return undefined;
  const raw = Array.isArray(et.scheduleRules) ? (et.scheduleRules as Array<Record<string, unknown>>) : [];
  const rules = raw
    .filter((r) => Array.isArray(r.days) && r.startTime && r.endTime)
    .map((r) => ({ days: (r.days as number[]) ?? [], startTime: String(r.startTime), endTime: String(r.endTime), date: null }));
  return rules.length ? rules : undefined;
}

// CoreTx is exported from with-org-core; re-import via core-ctx for callers that
// already hold a transaction (createBooking re-checks availability in-txn).
type Tx = CoreTx;

/** Load the availability rules (default schedule) for a set of resources. */
async function loadResourceAvailability(tx: Tx, orgId: string, resourceIds: string[]): Promise<ResourceAvailability[]> {
  if (!resourceIds.length) return [];
  const scheds = await tx
    .select()
    .from(schedSchedules)
    .where(and(eq(schedSchedules.orgId, orgId), inArray(schedSchedules.resourceId, resourceIds)));
  if (!scheds.length) return [];
  const rules = await tx
    .select()
    .from(schedAvailability)
    .where(inArray(schedAvailability.scheduleId, scheds.map((s) => s.id)));
  const rulesBySched = new Map<string, typeof rules>();
  for (const r of rules) {
    const list = rulesBySched.get(r.scheduleId) ?? [];
    list.push(r);
    rulesBySched.set(r.scheduleId, list);
  }
  // One default schedule per resource (the earliest); ignore extras for v1.
  const byResource = new Map<string, ResourceAvailability>();
  for (const s of scheds) {
    if (byResource.has(s.resourceId)) continue;
    byResource.set(s.resourceId, {
      resourceId: s.resourceId,
      timezone: s.timezone,
      rules: (rulesBySched.get(s.id) ?? []).map((r) => ({
        days: r.days,
        startTime: r.startTime,
        endTime: r.endTime,
        date: r.date,
      })),
    });
  }
  return [...byResource.values()];
}

/** Load active bookings for resources in [from, to], optionally excluding one booking id. */
async function loadBusy(tx: Tx, orgId: string, resourceIds: string[], from: Date, to: Date, excludeId?: string): Promise<BusyInterval[]> {
  if (!resourceIds.length) return [];
  const conds = [
    eq(schedBookings.orgId, orgId),
    inArray(schedBookings.resourceId, resourceIds),
    inArray(schedBookings.status, ['accepted', 'pending']),
    lte(schedBookings.startTime, to),
    gte(schedBookings.endTime, from),
  ];
  if (excludeId) conds.push(ne(schedBookings.id, excludeId));
  const rows = await tx
    .select({ resourceId: schedBookings.resourceId, start: schedBookings.startTime, end: schedBookings.endTime })
    .from(schedBookings)
    .where(and(...conds));
  return rows.map((r) => ({ resourceId: r.resourceId, start: r.start, end: r.end }));
}

function toSlotEventType(et: typeof schedEventTypes.$inferSelect): SlotEventType {
  return {
    length: et.length,
    slotInterval: et.slotInterval,
    beforeBuffer: et.beforeBuffer,
    afterBuffer: et.afterBuffer,
    minimumBookingNotice: et.minimumBookingNotice,
    periodType: et.periodType === 'unlimited' ? 'unlimited' : 'rolling',
    periodDays: et.periodDays,
    schedulingType:
      et.schedulingType === 'round_robin' || et.schedulingType === 'collective' ? et.schedulingType : null,
  };
}

export interface SlotsResult {
  eventType: typeof schedEventTypes.$inferSelect;
  resourceIds: string[];
  slots: Slot[];
}

/**
 * Compute bookable slots for an event type over [from, to].
 * `pinnedResourceId` (from a scheduling link) restricts to one resource.
 */
export async function getSlotsForEventType(
  ctx: CoreCtx,
  eventTypeId: string,
  from: Date,
  to: Date,
  opts: { now?: Date; pinnedResourceId?: string | null } = {},
): Promise<SlotsResult | null> {
  return withOrgCore(ctx, async (tx) => {
    const [et] = await tx
      .select()
      .from(schedEventTypes)
      .where(and(eq(schedEventTypes.id, eventTypeId), eq(schedEventTypes.orgId, ctx.tenantId)))
      .limit(1);
    if (!et || !et.active) return null;

    let resourceIds = (
      await tx
        .select({ resourceId: schedEventTypeResources.resourceId })
        .from(schedEventTypeResources)
        .where(eq(schedEventTypeResources.eventTypeId, eventTypeId))
    ).map((r) => r.resourceId);
    if (opts.pinnedResourceId) resourceIds = resourceIds.filter((r) => r === opts.pinnedResourceId);
    if (!resourceIds.length) return { eventType: et, resourceIds, slots: [] };

    // Only active resources are bookable.
    const activeResources = await tx
      .select({ id: schedResources.id })
      .from(schedResources)
      .where(and(eq(schedResources.orgId, ctx.tenantId), inArray(schedResources.id, resourceIds), eq(schedResources.active, true)));
    resourceIds = activeResources.map((r) => r.id);
    if (!resourceIds.length) return { eventType: et, resourceIds, slots: [] };

    const availability = await loadResourceAvailability(tx, ctx.tenantId, resourceIds);
    // Pad the busy lookup by the buffers so edge bookings are seen.
    const pad = (Math.max(et.beforeBuffer, et.afterBuffer) + et.length) * 60_000;
    const busy = await loadBusy(tx, ctx.tenantId, resourceIds, new Date(from.getTime() - pad), new Date(to.getTime() + pad));

    const slots = computeSlots({
      eventType: toSlotEventType(et),
      resources: availability,
      bookings: busy,
      rangeStart: from,
      rangeEnd: to,
      now: opts.now ?? new Date(),
      serviceRules: serviceRulesOf(et),
    });
    return { eventType: et, resourceIds, slots };
  });
}
