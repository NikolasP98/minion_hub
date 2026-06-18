import { and, eq, inArray, gte, lte, asc, desc, sql } from 'drizzle-orm';
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
import type { SchedBooking } from '$server/db/pg-scheduling-schema';
import { computeSlots } from '$server/scheduling/slots';
import type { ResourceAvailability, BusyInterval } from '$server/scheduling/slots';

const MS_PER_MIN = 60_000;
const ACTIVE_STATUSES = ['accepted', 'pending'] as const;

export class SlotUnavailableError extends Error {
  constructor() {
    super('slot no longer available');
    this.name = 'SlotUnavailableError';
  }
}

// Re-derive availability + busy inline (same txn) so booking creation never
// nests a withOrgCore transaction. Mirrors scheduling-slots.service helpers.
async function loadAvailability(tx: CoreTx, orgId: string, resourceIds: string[]): Promise<ResourceAvailability[]> {
  if (!resourceIds.length) return [];
  const scheds = await tx
    .select()
    .from(schedSchedules)
    .where(and(eq(schedSchedules.orgId, orgId), inArray(schedSchedules.resourceId, resourceIds)))
    .orderBy(asc(schedSchedules.createdAt));
  if (!scheds.length) return [];
  // One default schedule per resource (the earliest); ignore extras for v1.
  const byResource = new Map<string, (typeof scheds)[number]>();
  for (const s of scheds) if (!byResource.has(s.resourceId)) byResource.set(s.resourceId, s);
  const scheduleIds = [...byResource.values()].map((s) => s.id);
  const rules = await tx
    .select()
    .from(schedAvailability)
    .where(inArray(schedAvailability.scheduleId, scheduleIds));
  const rulesBySched = new Map<string, typeof rules>();
  for (const r of rules) {
    const list = rulesBySched.get(r.scheduleId) ?? [];
    list.push(r);
    rulesBySched.set(r.scheduleId, list);
  }
  const out: ResourceAvailability[] = [];
  for (const [resourceId, s] of byResource) {
    out.push({
      resourceId,
      timezone: s.timezone,
      rules: (rulesBySched.get(s.id) ?? []).map((r) => ({
        days: r.days,
        startTime: r.startTime,
        endTime: r.endTime,
        date: r.date,
      })),
    });
  }
  return out;
}

async function loadBusyInTx(tx: CoreTx, orgId: string, resourceIds: string[], from: Date, to: Date): Promise<BusyInterval[]> {
  if (!resourceIds.length) return [];
  const rows = await tx
    .select({ resourceId: schedBookings.resourceId, start: schedBookings.startTime, end: schedBookings.endTime })
    .from(schedBookings)
    .where(
      and(
        eq(schedBookings.orgId, orgId),
        inArray(schedBookings.resourceId, resourceIds),
        inArray(schedBookings.status, [...ACTIVE_STATUSES]),
        lte(schedBookings.startTime, to),
        gte(schedBookings.endTime, from),
      ),
    );
  return rows.map((r) => ({ resourceId: r.resourceId, start: r.start, end: r.end }));
}

export interface CreateBookingInput {
  eventTypeId: string;
  start: Date;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  attendeePhone?: string | null;
  notes?: string | null;
  source?: 'public_link' | 'internal' | 'import';
  /** Prefer this resource if it's free for the slot. */
  preferredResourceId?: string | null;
  /** Idempotency / reschedule ref. Generated when absent. */
  uid?: string;
  /** Internal staff bookings bypass min-notice + rolling-period (still respect conflicts). */
  bypassRules?: boolean;
  now?: Date;
}

/** Last-9-digit (Peru) phone normalizer, matching crm-finance.service. */
function phone9(raw: string): string {
  return raw.replace(/\D/g, '').slice(-9);
}

/** Resolve a CRM contact by phone (whatsapp identity) or email. Null if no match. */
async function resolveCrmContact(tx: CoreTx, orgId: string, phone: string | null | undefined, email: string | null | undefined): Promise<string | null> {
  const p9 = phone ? phone9(phone) : '';
  const em = email ? email.trim().toLowerCase() : '';
  if (p9.length < 8 && !em) return null;
  try {
    const rows = (await tx.execute(sql`
      select contact_id from crm_contact_identities
      where org_id = ${orgId}
        and (
          (channel = 'whatsapp' and length(regexp_replace(coalesce(external_id,''),'\\D','','g')) >= 8
            and right(regexp_replace(coalesce(external_id,''),'\\D','','g'), 9) = ${p9} and ${p9} <> '')
          or (channel = 'email' and lower(external_id) = ${em} and ${em} <> '')
        )
      limit 1
    `)) as unknown as Array<{ contact_id: string }>;
    return rows.length ? rows[0].contact_id : null;
  } catch {
    // CRM tables absent / disabled — booking still succeeds without the bridge.
    return null;
  }
}

export async function createBooking(ctx: CoreCtx, input: CreateBookingInput): Promise<SchedBooking> {
  return withOrgCore(ctx, async (tx) => {
    const [et] = await tx
      .select()
      .from(schedEventTypes)
      .where(and(eq(schedEventTypes.id, input.eventTypeId), eq(schedEventTypes.orgId, ctx.tenantId)))
      .limit(1);
    if (!et || !et.active) throw new SlotUnavailableError();

    const start = input.start;
    const end = new Date(start.getTime() + et.length * MS_PER_MIN);

    // Candidate resources: the event type's active assignees (or the preferred one).
    let candidateIds = (
      await tx
        .select({ resourceId: schedEventTypeResources.resourceId })
        .from(schedEventTypeResources)
        .where(eq(schedEventTypeResources.eventTypeId, et.id))
    ).map((r) => r.resourceId);
    if (input.preferredResourceId) candidateIds = candidateIds.filter((r) => r === input.preferredResourceId);
    const active = await tx
      .select({ id: schedResources.id })
      .from(schedResources)
      .where(and(eq(schedResources.orgId, ctx.tenantId), inArray(schedResources.id, candidateIds.length ? candidateIds : ['00000000-0000-0000-0000-000000000000']), eq(schedResources.active, true)));
    candidateIds = active.map((r) => r.id);
    if (!candidateIds.length) throw new SlotUnavailableError();

    const availability = await loadAvailability(tx, ctx.tenantId, candidateIds);
    const pad = (Math.max(et.beforeBuffer, et.afterBuffer) + et.length) * MS_PER_MIN;
    const busy = await loadBusyInTx(tx, ctx.tenantId, candidateIds, new Date(start.getTime() - pad), new Date(end.getTime() + pad));

    const slots = computeSlots({
      eventType: {
        length: et.length,
        slotInterval: et.slotInterval,
        beforeBuffer: et.beforeBuffer,
        afterBuffer: et.afterBuffer,
        minimumBookingNotice: input.bypassRules ? 0 : et.minimumBookingNotice,
        periodType: input.bypassRules ? 'unlimited' : et.periodType === 'unlimited' ? 'unlimited' : 'rolling',
        periodDays: input.bypassRules ? null : et.periodDays,
        schedulingType: et.schedulingType === 'round_robin' || et.schedulingType === 'collective' ? et.schedulingType : null,
      },
      resources: availability,
      bookings: busy,
      rangeStart: start,
      rangeEnd: end,
      now: input.now ?? new Date(),
    });
    const match = slots.find((s) => s.start.getTime() === start.getTime());
    if (!match || !match.resourceIds.length) throw new SlotUnavailableError();

    // Pick the resource: preferred if free, else least-loaded that day (round-robin), else first.
    let chosen = match.resourceIds[0];
    if (input.preferredResourceId && match.resourceIds.includes(input.preferredResourceId)) {
      chosen = input.preferredResourceId;
    } else if (match.resourceIds.length > 1) {
      const loads = new Map<string, number>();
      for (const b of busy) loads.set(b.resourceId, (loads.get(b.resourceId) ?? 0) + 1);
      chosen = [...match.resourceIds].sort((a, b) => (loads.get(a) ?? 0) - (loads.get(b) ?? 0))[0];
    }

    const crmContactId = await resolveCrmContact(tx, ctx.tenantId, input.attendeePhone, input.attendeeEmail);
    const uid = input.uid ?? globalThis.crypto.randomUUID();
    const status = et.requiresConfirmation ? 'pending' : 'accepted';

    const [row] = await tx
      .insert(schedBookings)
      .values({
        orgId: ctx.tenantId,
        uid,
        eventTypeId: et.id,
        resourceId: chosen,
        startTime: start,
        endTime: end,
        status,
        title: et.title,
        notes: input.notes ?? null,
        attendeeName: input.attendeeName ?? null,
        attendeeEmail: input.attendeeEmail ?? null,
        attendeePhone: input.attendeePhone ?? null,
        crmContactId,
        productId: et.productId,
        source: input.source ?? 'internal',
      })
      .onConflictDoNothing({ target: [schedBookings.orgId, schedBookings.uid] })
      .returning();
    if (!row) {
      // uid already used — return the existing booking (idempotent retry).
      const [existing] = await tx
        .select()
        .from(schedBookings)
        .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.uid, uid)))
        .limit(1);
      return existing;
    }
    return row;
  });
}

export interface ListBookingsOpts {
  from?: Date;
  to?: Date;
  status?: string[];
  resourceId?: string;
  limit?: number;
}

export function listBookings(ctx: CoreCtx, opts: ListBookingsOpts = {}): Promise<SchedBooking[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(schedBookings.orgId, ctx.tenantId)];
    if (opts.from) conds.push(gte(schedBookings.startTime, opts.from));
    if (opts.to) conds.push(lte(schedBookings.startTime, opts.to));
    if (opts.status?.length) conds.push(inArray(schedBookings.status, opts.status));
    if (opts.resourceId) conds.push(eq(schedBookings.resourceId, opts.resourceId));
    return tx
      .select()
      .from(schedBookings)
      .where(and(...conds))
      .orderBy(desc(schedBookings.startTime))
      .limit(Math.min(opts.limit ?? 500, 2000));
  });
}

const SETTABLE = new Set(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show']);

export async function setBookingStatus(ctx: CoreCtx, id: string, status: string): Promise<void> {
  if (!SETTABLE.has(status)) throw new Error(`invalid status: ${status}`);
  await withOrgCore(ctx, (tx) =>
    tx
      .update(schedBookings)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId))),
  );
}
