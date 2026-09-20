import { and, eq, ne, inArray, gt, gte, isNull, isNotNull, lte, asc, desc, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { maskPii } from '$lib/pii';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  schedResources,
  schedSchedules,
  schedAvailability,
  schedEventTypes,
  schedEventTypeResources,
  schedBookings,
  schedBookingStatusLog,
} from '$server/db/pg-scheduling-schema';
import { crmContacts, crmContactIdentities, tagLinks } from '$server/db/pg-crm-schema';
import { profiles } from '@minion-stack/db/pg';
import type {
  SchedBooking,
  SchedBookingStatusLog,
  SchedEventType,
  SchedResource,
} from '$server/db/pg-scheduling-schema';
import { schedReminders } from '$server/db/pg-reminders-schema';
import {
  posPackageRedemptions,
  posPaymentPlans,
  posTickets,
  posTicketLines,
} from '$server/db/pg-pos-schema';
import { parties } from '$server/db/pg-party-schema';
import { finInvoices } from '$server/db/pg-finance-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { stkAccruals } from '$server/db/pg-schema/stock';
import { computeSlots, intervalsOverlap } from '$server/scheduling/slots';
import type { ResourceAvailability, BusyInterval } from '$server/scheduling/slots';
import { serviceRulesOf } from './scheduling-slots.service';
import { assertOrgEventKind } from './scheduling.service';
import { emitHubEvent } from '$server/events/emit';
import {
  accrueConsumption,
  accrualSummaryForSources,
  releaseAccruals,
  type AccrualLineInput,
  type AccrualSourceSummary,
} from './stock-accruals.service';
import { isModuleEnabled } from './modules.service';
import { recordAuditInTx, type FieldChange } from './activity.service';
import {
  getGrant,
  redeemSessionInTx,
  reverseRedemptionInTx,
  type GrantView,
} from './pos-packages.service';
import { getPlan, type PlanDetail } from './pos-accounts.service';
import { grantToday } from './pos-accounts.logic';
import { getFinSettings } from './finance.service';
import { PosError, type Actor } from './pos.service';

const MS_PER_MIN = 60_000;
const ACTIVE_STATUSES = ['accepted', 'pending'] as const;

export class SlotUnavailableError extends Error {
  /** `resource_not_assigned`: a forced/preferred resource is not an assignee of
   *  the event type — a picker/data mismatch, not a taken slot. */
  constructor(
    public readonly reason: 'slot_unavailable' | 'resource_not_assigned' = 'slot_unavailable',
  ) {
    super(
      reason === 'resource_not_assigned'
        ? 'resource not assigned to this service'
        : 'slot no longer available',
    );
    this.name = 'SlotUnavailableError';
  }
}

/** Thrown by `rescheduleBooking` when the target resource/time clashes with
 *  another booking (buffer-padded). Message names the clashing time so it can
 *  be surfaced verbatim in a 409 response / toast. */
export class BookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingConflictError';
  }
}

// Re-derive availability + busy inline (same txn) so booking creation never
// nests a withOrgCore transaction. Mirrors scheduling-slots.service helpers.
async function loadAvailability(
  tx: CoreTx,
  orgId: string,
  resourceIds: string[],
): Promise<ResourceAvailability[]> {
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

async function loadBusyInTx(
  tx: CoreTx,
  orgId: string,
  resourceIds: string[],
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  if (!resourceIds.length) return [];
  const rows = await tx
    .select({
      resourceId: schedBookings.resourceId,
      start: schedBookings.startTime,
      end: schedBookings.endTime,
    })
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
  /** Link to a specific CRM contact (internal booking picked one). When set it's
   *  used directly; otherwise the contact is resolved/created from phone/email. */
  crmContactId?: string | null;
  /** Party-spine pick (CustomerPicker). Resolves to the party's CRM contact when
   *  no crmContactId is given; a party without a contact falls back to phone/email. */
  partyId?: string | null;
  source?: 'public_link' | 'internal' | 'import';
  /** Prefer this resource if it's free for the slot. */
  preferredResourceId?: string | null;
  /** Idempotency / reschedule ref. Generated when absent. */
  uid?: string;
  /** Internal staff bookings bypass min-notice + rolling-period (still respect conflicts). */
  bypassRules?: boolean;
  /** Front-desk walk-in: narrow candidates to exactly this resource before slot
   *  computation. If it has no matching free slot at `start` → SlotUnavailableError
   *  (never silently reassigned to another assignee). */
  forceResourceId?: string;
  /** Requires `forceResourceId`. Skips slot computation entirely and books at
   *  `input.start` verbatim once the event type + forced resource are validated. */
  overrideConflicts?: boolean;
  now?: Date;
  /** Adjusted stock-consumption lines from the booking modal (consumption uom).
   *  Absent → defaults accrue from the product's stk_consumption mapping. */
  consumption?: AccrualLineInput[] | null;
  /** This booking's own event kind (spec §1/§2.1). Validated as an org kind
   *  when set; absent/null leaves the booking resolving to the event type's
   *  kind (then the org default) at read time. */
  kindId?: string | null;
  /** Draw one session from this package grant (pos_package_grants.id) INSIDE the
   *  booking transaction — the booking and the redemption commit together or not
   *  at all. Surfaces PosError `package_exhausted` / `package_expired`. §3.2. */
  packageGrantId?: string | null;
  /** The instalment plan funding this event (pos_payment_plans.id). §3.4. */
  paymentPlanId?: string | null;
  /** Client-visible note — `notes` stays internal (§4.1 shows both). */
  clientNote?: string | null;
  /** Display title; defaults to the event type's title. */
  title?: string | null;
  /** Free-form facts (e.g. `followUpOf` for a checkup that follows a paid treatment). */
  metadata?: Record<string, unknown>;
  /** Who is acting. Stamped on the redemption and on the status-log row. */
  actor?: Actor;
}

/** Last-9-digit (Peru) phone normalizer, matching crm-finance.service. */
function phone9(raw: string): string {
  return raw.replace(/\D/g, '').slice(-9);
}

/** Resolve a CRM contact by phone (whatsapp identity) or email. Null if no match. */
async function resolveCrmContact(
  tx: CoreTx,
  orgId: string,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<string | null> {
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

/**
 * Resolve a CRM contact by phone/email, or CREATE one from the booking form so
 * every booker lands in the CRM. The resolve-first step is the dedup guard:
 * an existing customer is matched (last-9 phone or email) and reused, never
 * duplicated. Identities are stored E.164 (`+digits`) to match the ledger
 * harvest's `external_id` shape so a later WhatsApp message folds into the same
 * contact via the unique (org, channel, external_id) index.
 * ponytail: 9-digit local input (no country code) can still diverge from the
 * harvest's `+51…`; resolve's last-9 match keeps future bookings deduped, the
 * rare format-mismatch harvest dupe is the CRM cleanup tool's job.
 */
async function ensureCrmContact(
  tx: CoreTx,
  orgId: string,
  name: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<string | null> {
  const existing = await resolveCrmContact(tx, orgId, phone, email);
  if (existing) return existing;
  const digits = phone ? phone.replace(/\D/g, '') : '';
  const em = email ? email.trim().toLowerCase() : '';
  if (digits.length < 8 && !em) return null; // nothing to identify them by
  try {
    const [c] = await tx
      .insert(crmContacts)
      .values({ orgId, displayName: name?.trim() || null, source: 'booking' })
      .returning({ id: crmContacts.id });
    const identities: Array<typeof crmContactIdentities.$inferInsert> = [];
    if (digits.length >= 8)
      identities.push({
        orgId,
        contactId: c.id,
        channel: 'whatsapp',
        externalId: `+${digits}`,
        handle: name?.trim() || null,
      });
    if (em)
      identities.push({
        orgId,
        contactId: c.id,
        channel: 'email',
        externalId: em,
        handle: name?.trim() || null,
      });
    if (identities.length)
      await tx
        .insert(crmContactIdentities)
        .values(identities)
        .onConflictDoNothing({
          target: [
            crmContactIdentities.orgId,
            crmContactIdentities.channel,
            crmContactIdentities.externalId,
          ],
        });
    return c.id;
  } catch {
    // CRM tables absent / disabled — booking still succeeds without the bridge.
    return null;
  }
}

/** Where one occurrence lands, plus the series bookkeeping it carries. */
interface OccurrenceOpts {
  start: Date;
  /** Shared by every occurrence of one series; null for a standalone booking. */
  seriesId?: string | null;
  seriesIndex?: number | null;
  /** Today's 'YYYY-MM-DD' in the org's business timezone. Required (and only
   *  resolved) when `input.packageGrantId` is set — see `orgDateKey`. */
  today?: string | null;
}

/**
 * Book ONE occurrence inside a caller's transaction. Everything a booking must
 * do atomically lives here: slot validation, the row, the package redemption
 * and the creation entry in the status log.
 *
 * Factored out of `createBooking` so a series can run N of these in a single
 * transaction — occurrences read their own predecessors back through
 * `loadBusyInTx` (same txn sees its own writes), so a series can't double-book
 * itself, and a failure on slot 3 rolls slots 1-2 and their redemptions back.
 */
async function bookOccurrenceInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  input: CreateBookingInput,
  occ: OccurrenceOpts,
): Promise<{ row: SchedBooking; created: boolean }> {
  const [et] = await tx
    .select()
    .from(schedEventTypes)
    .where(and(eq(schedEventTypes.id, input.eventTypeId), eq(schedEventTypes.orgId, ctx.tenantId)))
    .limit(1);
  if (!et || !et.active) throw new SlotUnavailableError();
  if (input.kindId) await assertOrgEventKind(tx, ctx.tenantId, input.kindId);

  const start = occ.start;
  const end = new Date(start.getTime() + et.length * MS_PER_MIN);

  // Candidate resources: the event type's active assignees (or the preferred one).
  let candidateIds = (
    await tx
      .select({ resourceId: schedEventTypeResources.resourceId })
      .from(schedEventTypeResources)
      .where(eq(schedEventTypeResources.eventTypeId, et.id))
  ).map((r) => r.resourceId);
  if (input.preferredResourceId)
    candidateIds = candidateIds.filter((r) => r === input.preferredResourceId);
  // Front-desk walk-in override: narrow to exactly this resource. A non-assignee
  // force id filters candidates to empty → SlotUnavailableError below (no silent reassign).
  if (input.forceResourceId) {
    candidateIds = candidateIds.filter((r) => r === input.forceResourceId);
    if (!candidateIds.length) throw new SlotUnavailableError('resource_not_assigned');
  }
  const active = await tx
    .select({ id: schedResources.id })
    .from(schedResources)
    .where(
      and(
        eq(schedResources.orgId, ctx.tenantId),
        inArray(
          schedResources.id,
          candidateIds.length ? candidateIds : ['00000000-0000-0000-0000-000000000000'],
        ),
        eq(schedResources.active, true),
      ),
    );
  candidateIds = active.map((r) => r.id);
  if (!candidateIds.length) throw new SlotUnavailableError();

  let chosen: string;
  if (input.overrideConflicts) {
    // Walk-in override: event type + forced resource existence/active are already
    // validated above. Skip slot computation entirely and book at `start` verbatim
    // — the row still lands in sched_bookings, so it's picked up as a normal busy
    // interval by every future computeSlots call (no special-casing needed there).
    chosen = candidateIds[0];
  } else {
    const availability = await loadAvailability(tx, ctx.tenantId, candidateIds);
    const pad = (Math.max(et.beforeBuffer, et.afterBuffer) + et.length) * MS_PER_MIN;
    const busy = await loadBusyInTx(
      tx,
      ctx.tenantId,
      candidateIds,
      new Date(start.getTime() - pad),
      new Date(end.getTime() + pad),
    );

    const slots = computeSlots({
      eventType: {
        length: et.length,
        slotInterval: et.slotInterval,
        beforeBuffer: et.beforeBuffer,
        afterBuffer: et.afterBuffer,
        minimumBookingNotice: input.bypassRules ? 0 : et.minimumBookingNotice,
        periodType: input.bypassRules
          ? 'unlimited'
          : et.periodType === 'unlimited'
            ? 'unlimited'
            : 'rolling',
        periodDays: input.bypassRules ? null : et.periodDays,
        schedulingType:
          et.schedulingType === 'round_robin' || et.schedulingType === 'collective'
            ? et.schedulingType
            : null,
      },
      resources: availability,
      bookings: busy,
      rangeStart: start,
      rangeEnd: end,
      now: input.now ?? new Date(),
      serviceRules: serviceRulesOf(et),
    });
    const match = slots.find((s) => s.start.getTime() === start.getTime());
    if (!match || !match.resourceIds.length) throw new SlotUnavailableError();

    // Pick the resource: preferred if free, else least-loaded that day (round-robin), else first.
    chosen = match.resourceIds[0];
    if (input.preferredResourceId && match.resourceIds.includes(input.preferredResourceId)) {
      chosen = input.preferredResourceId;
    } else if (match.resourceIds.length > 1) {
      const loads = new Map<string, number>();
      for (const b of busy) loads.set(b.resourceId, (loads.get(b.resourceId) ?? 0) + 1);
      chosen = [...match.resourceIds].sort((a, b) => (loads.get(a) ?? 0) - (loads.get(b) ?? 0))[0];
    }
  }

  // Explicit customer facets are authority, not hints: never silently replace
  // a selected customer with a phone/email match for a different person.
  let partyId = input.partyId ?? null;
  let crmContactId: string | null = null;
  if (input.crmContactId) {
    const [hit] = await tx
      .select({ id: crmContacts.id, partyId: crmContacts.partyId })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, input.crmContactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (!hit) throw new PosError('customer not found', 'booking_customer_not_found');
    if (partyId && hit.partyId !== partyId)
      throw new PosError('customer facets disagree', 'booking_customer_mismatch');
    crmContactId = hit.id;
    partyId = hit.partyId ?? partyId;
  }
  if (partyId) {
    const [party] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, partyId), eq(parties.orgId, ctx.tenantId)))
      .limit(1);
    if (!party) throw new PosError('customer not found', 'booking_customer_not_found');
  }
  if (!crmContactId && partyId) {
    const [hit] = await tx
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.partyId, partyId), eq(crmContacts.orgId, ctx.tenantId)))
      .orderBy(asc(crmContacts.id))
      .limit(1);
    if (hit) crmContactId = hit.id;
  }
  if (!crmContactId && !partyId) {
    crmContactId = await ensureCrmContact(
      tx,
      ctx.tenantId,
      input.attendeeName,
      input.attendeePhone,
      input.attendeeEmail,
    );
    if (crmContactId) {
      const [contact] = await tx
        .select({ partyId: crmContacts.partyId })
        .from(crmContacts)
        .where(and(eq(crmContacts.id, crmContactId), eq(crmContacts.orgId, ctx.tenantId)))
        .limit(1);
      partyId = contact?.partyId ?? null;
    }
  }

  // A client-supplied plan id remains a hint, not
  // authority. A foreign/stale one is dropped rather than stored as a dangling
  // pointer the drawer would then fail to resolve. (packageGrantId needs no
  // check here — `redeemSessionInTx` loads the grant org-scoped and throws.)
  let paymentPlanId: string | null = null;
  if (input.paymentPlanId) {
    const [plan] = await tx
      .select({ id: posPaymentPlans.id })
      .from(posPaymentPlans)
      .where(
        and(eq(posPaymentPlans.id, input.paymentPlanId), eq(posPaymentPlans.orgId, ctx.tenantId)),
      )
      .limit(1);
    paymentPlanId = plan?.id ?? null;
  }
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
      title: input.title ?? et.title,
      metadata: input.metadata ?? {},
      notes: input.notes ?? null,
      clientNote: input.clientNote ?? null,
      attendeeName: input.attendeeName ?? null,
      attendeeEmail: input.attendeeEmail ?? null,
      attendeePhone: input.attendeePhone ?? null,
      crmContactId,
      partyId,
      productId: et.productId,
      kindId: input.kindId ?? null,
      source: input.source ?? 'internal',
      packageGrantId: input.packageGrantId ?? null,
      paymentPlanId,
      seriesId: occ.seriesId ?? null,
      seriesIndex: occ.seriesIndex ?? null,
    })
    .onConflictDoNothing({ target: [schedBookings.orgId, schedBookings.uid] })
    .returning();
  if (!row) {
    // uid already used — return the existing booking (idempotent retry). No
    // redemption and no log row: this call created nothing.
    const [existing] = await tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.uid, uid)))
      .limit(1);
    if (
      !existing ||
      existing.productId !== et.productId ||
      (existing.partyId ?? null) !== partyId ||
      (existing.crmContactId ?? null) !== crmContactId
    )
      throw new PosError(
        'booking retry has different customer or service',
        'booking_retry_mismatch',
      );
    return { row: existing, created: false };
  }

  // Draw the session INSIDE this transaction: an exhausted/expired grant throws
  // and takes the booking row with it, so a session can never be handed out
  // without a booking (or a booking made without the session it claims).
  if (input.packageGrantId) {
    if (!occ.today) throw new Error('package redemption requires the org date key');
    await redeemSessionInTx(
      tx,
      ctx.tenantId,
      { grantId: input.packageGrantId, bookingId: row.id, actor: input.actor },
      occ.today,
    );
  }

  await tx.insert(schedBookingStatusLog).values({
    orgId: ctx.tenantId,
    bookingId: row.id,
    fromStatus: null, // null = the row recording creation
    toStatus: status,
    reason: null,
    changedBy: input.actor?.id ?? ctx.profileId ?? null,
  });
  await emitHubEvent(tx, { type: 'booking.created', orgId: ctx.tenantId, bookingId: row.id });
  return { row, created: true };
}

/**
 * Today's date key in the org's business timezone, resolved ONLY when a package
 * grant is in play (it costs a settings round-trip) and always BEFORE the
 * booking transaction opens — `getFinSettings` runs its own `withOrgCore`, and
 * withOrgCore must never nest.
 */
async function orgDateKey(
  ctx: CoreCtx,
  grantId: string | null | undefined,
): Promise<string | null> {
  if (!grantId) return null;
  return grantToday((await getFinSettings(ctx)).timezone);
}

/**
 * Post-commit accrual: expected stock consumption for the booked service.
 * Deliberately OUTSIDE the booking tx (a failed statement would poison it)
 * and fail-soft — a booking must never fail because of accrual bookkeeping.
 * Idempotent uid retries have created=false and never re-accrue.
 */
async function accrueForBooking(
  ctx: CoreCtx,
  row: SchedBooking,
  lines: AccrualLineInput[] | null,
): Promise<void> {
  if (!row.productId) return;
  try {
    if (await isModuleEnabled(ctx, 'stock')) {
      await accrueConsumption(ctx, {
        source: 'booking',
        sourceId: row.id,
        finProductId: row.productId,
        lines,
      });
    }
  } catch (e) {
    console.error('[scheduling] accrueConsumption failed (booking stands)', e);
  }
}

export async function createBooking(
  ctx: CoreCtx,
  input: CreateBookingInput,
): Promise<SchedBooking> {
  if (input.overrideConflicts && !input.forceResourceId)
    throw new Error('overrideConflicts requires forceResourceId');
  const today = await orgDateKey(ctx, input.packageGrantId);
  const { row, created } = await withOrgCore(ctx, (tx) =>
    bookOccurrenceInTx(tx, ctx, input, { start: input.start, today }),
  );
  if (created) await accrueForBooking(ctx, row, input.consumption ?? null);
  return row;
}

/** A booking these statuses mean "this appointment is gone" — a line pointing at
 *  one is stuck, not idempotently re-playable. */
const DEAD_BOOKING_STATUSES = new Set(['cancelled', 'rejected']);

export interface BookTicketLineInput extends CreateBookingInput {
  /** The submitted POS ticket the service was sold on. */
  ticketId: string;
  /** The `kind = 'service'` line to stamp. */
  lineId: string;
}

export interface BookTicketLineResult {
  booking: SchedBooking;
  /** false = the line was ALREADY linked to this live booking (idempotent replay). */
  created: boolean;
}

/**
 * Book an appointment for a sold POS service line — the ONE write the
 * `/pos/sell?step=schedule` flow makes.
 *
 * ## Transaction boundary
 *
 * INSIDE the single transaction, all-or-nothing:
 *   · the ticket/line authority + state checks (org-scoped; every id on the
 *     wire is a plain uuid column, so an unchecked one crosses tenants);
 *   · the booking row itself — slot/conflict validation, minimum notice and
 *     resource availability all still run in `bookOccurrenceInTx`;
 *   · the package redemption, when the booking draws a session from a grant;
 *   · the creation row in `sched_booking_status_log`;
 *   · the `pos_ticket_lines.booking_id` claim against the locked prior value;
 *   · an audit linking the prior cancelled/rejected appointment to its replacement.
 * A failure anywhere — an unavailable slot, an exhausted grant, a line another
 * cashier claimed a millisecond earlier — rolls the booking back with it. That
 * is the whole point: the old two-call flow (`POST /api/scheduling/bookings`
 * then `POST /api/pos/tickets/:id/schedule`) left an ORPHAN appointment behind
 * whenever the second call failed, and the retry booked a SECOND one.
 *
 * AFTER the commit, deliberately fail-soft — the same line `createBooking`
 * draws, for the same reason: bookkeeping must never undo a committed
 * appointment.
 *   · the stock accrual for the booked service (`accrueForBooking`), which is
 *     idempotent and re-triggerable from the booking's accrual route;
 *   · reminders, which are a scheduled tick reading committed rows.
 *
 * Idempotency anchor is the LINE, not a client token: a double-submit finds it
 * already pointing at a live booking and gets that booking back with
 * `created: false` — never a second appointment.
 */
export async function bookAndLinkTicketLine(
  ctx: CoreCtx,
  input: BookTicketLineInput,
): Promise<BookTicketLineResult> {
  if (input.overrideConflicts && !input.forceResourceId)
    throw new Error('overrideConflicts requires forceResourceId');
  // Resolved BEFORE the transaction opens — `getFinSettings` runs its own
  // `withOrgCore`, and withOrgCore must never nest.
  const today = await orgDateKey(ctx, input.packageGrantId);

  const out = await withOrgCore(ctx, async (tx): Promise<BookTicketLineResult> => {
    const [ticket] = await tx
      .select({
        status: posTickets.status,
        partyId: posTickets.partyId,
        crmContactId: posTickets.crmContactId,
      })
      .from(posTickets)
      .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.id, input.ticketId)))
      .limit(1)
      .for('update');
    // Org-scoped read: a foreign ticket id is "not found", never someone else's row.
    if (!ticket) throw new PosError('ticket not found', 'not_found');
    // BUG (2026-09-16 lifecycle-b QA): this compared against 'voided', but
    // voidTicket persists status 'void' (pos.service.ts) — the check could
    // never fire, so a voided ticket could still be scheduled after reload.
    if (ticket.status === 'void' || ticket.status === 'voided')
      throw new PosError('ticket is void', 'ticket_void');

    const [line] = await tx
      .select({
        kind: posTicketLines.kind,
        bookingId: posTicketLines.bookingId,
        finProductId: posTicketLines.finProductId,
        planId: posTicketLines.planId,
      })
      .from(posTicketLines)
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.id, input.lineId),
          eq(posTicketLines.ticketId, input.ticketId),
        ),
      )
      .limit(1)
      .for('update');
    if (!line) throw new PosError('line not found', 'not_found');
    if (line.kind !== 'service' || line.planId)
      throw new PosError('line is not a service', 'line_not_service');

    if (line.bookingId) {
      const [existing] = await tx
        .select()
        .from(schedBookings)
        .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.id, line.bookingId)))
        .limit(1)
        .for('update');
      // Replay of the same submit → the same appointment, 200, nothing created.
      if (existing && !DEAD_BOOKING_STATUSES.has(existing.status))
        return { booking: existing, created: false };
      if (!existing) throw new PosError('linked appointment not found', 'booking_not_found');
    }

    const [eventType] = await tx
      .select({ productId: schedEventTypes.productId })
      .from(schedEventTypes)
      .where(
        and(eq(schedEventTypes.orgId, ctx.tenantId), eq(schedEventTypes.id, input.eventTypeId)),
      )
      .limit(1);
    if (!line.finProductId || eventType?.productId !== line.finProductId)
      throw new PosError('service differs from sold product', 'booking_product_mismatch');
    if (
      (ticket.partyId && input.partyId && ticket.partyId !== input.partyId) ||
      (ticket.crmContactId && input.crmContactId && ticket.crmContactId !== input.crmContactId)
    )
      throw new PosError('customer differs from ticket', 'booking_customer_mismatch');

    // The reminder channel needs a recipient. The till's DNI quick-add persists
    // the optional phone on the PARTY, so fall back to the party spine when the
    // form sent none.
    let attendeePhone = input.attendeePhone ?? null;
    if (!attendeePhone && ticket.partyId) {
      const [party] = await tx
        .select({ phone9: parties.phone9 })
        .from(parties)
        .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.id, ticket.partyId)))
        .limit(1);
      attendeePhone = party?.phone9 ?? null;
    }

    const booked = await bookOccurrenceInTx(
      tx,
      ctx,
      {
        ...input,
        attendeePhone,
        partyId: ticket.partyId ?? input.partyId,
        crmContactId: ticket.crmContactId ?? input.crmContactId,
      },
      { start: input.start, today },
    );
    // A legitimate retry returned through the locked line above. An unrelated
    // pre-existing UID must not let two paid lines claim the same appointment.
    if (!booked.created || DEAD_BOOKING_STATUSES.has(booked.row.status))
      throw new PosError('appointment UID already used', 'booking_retry_mismatch');
    if (booked.row.productId !== line.finProductId)
      throw new PosError('service differs from sold product', 'booking_product_mismatch');
    if (
      (ticket.partyId && booked.row.partyId !== ticket.partyId) ||
      (ticket.crmContactId && booked.row.crmContactId !== ticket.crmContactId)
    )
      throw new PosError('customer differs from ticket', 'booking_customer_mismatch');

    // Only validated booking identity may fill an anonymous ticket's facets.
    if (
      (!ticket.partyId && booked.row.partyId) ||
      (!ticket.crmContactId && booked.row.crmContactId)
    ) {
      await tx
        .update(posTickets)
        .set({
          partyId: booked.row.partyId,
          crmContactId: booked.row.crmContactId,
          ...(!ticket.partyId && !ticket.crmContactId && booked.row.attendeeName
            ? { customerName: booked.row.attendeeName }
            : {}),
        })
        .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.id, input.ticketId)));
    }

    const [claimed] = await tx
      .update(posTicketLines)
      .set({ bookingId: booked.row.id })
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.id, input.lineId),
          eq(posTicketLines.ticketId, input.ticketId),
          line.bookingId
            ? eq(posTicketLines.bookingId, line.bookingId)
            : isNull(posTicketLines.bookingId),
        ),
      )
      .returning({ id: posTicketLines.id });
    // Lost the race for the line → the booking just inserted goes back with it.
    if (!claimed) throw new PosError('line already scheduled', 'line_already_scheduled');

    if (line.bookingId)
      await recordAuditInTx(tx, ctx, {
        refType: 'pos_ticket',
        refId: input.ticketId,
        op: 'update',
        changes: [
          {
            field: `lines.${input.lineId}.bookingId`,
            label: 'Service appointment',
            old: line.bookingId,
            new: booked.row.id,
          },
        ],
        actor: { id: input.actor?.id ?? ctx.profileId ?? null, name: input.actor?.name ?? null },
      });

    return { booking: booked.row, created: booked.created };
  });

  if (out.created) await accrueForBooking(ctx, out.booking, input.consumption ?? null);
  return out;
}

/** Hard cap on one series — a typo'd weekly course must not mint 10k rows. */
export const MAX_SERIES_SLOTS = 52;

export interface CreateBookingSeriesInput extends Omit<CreateBookingInput, 'start' | 'uid'> {
  /** One start instant per occurrence. Sorted ascending before booking, so
   *  `series_index` always follows chronological order (which is what the
   *  `scope: 'following'` cancel walks). */
  slots: Date[];
}

/**
 * Book N occurrences of one course in a SINGLE transaction (spec §3.3): they
 * share a generated `series_id`, carry `series_index` 0..N-1, and each draws a
 * session from the same grant. Any failure — an unavailable slot, an exhausted
 * package on the last one — rolls back every booking and every redemption, so
 * the client is never left with half a course and 3 sessions gone.
 */
export async function createBookingSeries(
  ctx: CoreCtx,
  input: CreateBookingSeriesInput,
): Promise<SchedBooking[]> {
  if (input.overrideConflicts && !input.forceResourceId)
    throw new Error('overrideConflicts requires forceResourceId');
  if (!input.slots.length) throw new Error('a series needs at least one slot');
  if (input.slots.length > MAX_SERIES_SLOTS)
    throw new Error(`a series is capped at ${MAX_SERIES_SLOTS} slots`);
  const slots = [...input.slots].sort((a, b) => a.getTime() - b.getTime());
  const today = await orgDateKey(ctx, input.packageGrantId);
  const seriesId = globalThis.crypto.randomUUID();

  const rows = await withOrgCore(ctx, async (tx) => {
    const out: SchedBooking[] = [];
    for (let i = 0; i < slots.length; i++) {
      const { row, created } = await bookOccurrenceInTx(
        tx,
        ctx,
        { ...input, start: slots[i] },
        {
          start: slots[i],
          seriesId,
          seriesIndex: i,
          today,
        },
      );
      // Every occurrence generates its own uid, so "not created" means a uid
      // collision — treat it as a failed occurrence rather than silently
      // adopting someone else's booking into this series.
      if (!created) throw new SlotUnavailableError();
      out.push(row);
    }
    return out;
  });

  for (const row of rows) await accrueForBooking(ctx, row, input.consumption ?? null);
  return rows;
}

export interface ListBookingsOpts {
  from?: Date;
  to?: Date;
  status?: string[];
  resourceId?: string;
  crmContactId?: string;
  limit?: number;
  /** Field-level (Phase 4): redact attendee phone/email below the scheduling field level. */
  maskAttendeePii?: boolean;
}

export async function listBookings(
  ctx: CoreCtx,
  opts: ListBookingsOpts = {},
): Promise<SchedBooking[]> {
  const rows = await withOrgCore(ctx, (tx) => {
    const conds = [eq(schedBookings.orgId, ctx.tenantId)];
    if (opts.from) conds.push(gte(schedBookings.startTime, opts.from));
    if (opts.to) conds.push(lte(schedBookings.startTime, opts.to));
    if (opts.status?.length) conds.push(inArray(schedBookings.status, opts.status));
    if (opts.resourceId) conds.push(eq(schedBookings.resourceId, opts.resourceId));
    if (opts.crmContactId) conds.push(eq(schedBookings.crmContactId, opts.crmContactId));
    return tx
      .select()
      .from(schedBookings)
      .where(and(...conds))
      .orderBy(desc(schedBookings.startTime))
      .limit(Math.min(opts.limit ?? 500, 2000));
  });
  if (!opts.maskAttendeePii) return rows;
  return rows.map((b) => ({
    ...b,
    attendeeEmail: b.attendeeEmail ? maskPii(b.attendeeEmail) : b.attendeeEmail,
    attendeePhone: b.attendeePhone ? maskPii(b.attendeePhone) : b.attendeePhone,
  }));
}

const SETTABLE = new Set(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show']);
/** Statuses meaning "this appointment did not happen": open accruals go back to
 *  stock AND the package session goes back to the client. `completed` is the
 *  only terminal status that KEEPS the session consumed (spec §3.2). */
const RELEASING = new Set(['cancelled', 'rejected', 'no_show']);

export interface StatusChangeOpts {
  /** Free text stored on the status-log row (and on the reversal). */
  reason?: string | null;
  actor?: Actor;
}

/** Hand every live session this booking drew back to the client. Idempotent —
 *  `reverseRedemptionInTx` returns an already-reversed row untouched.
 *
 *  TODO(handoff): RESCHEDULE currently loses the package link. The only
 *  reschedule path (`src/routes/api/gateway/actions/booking-reschedule`) books a
 *  NEW booking and cancels the old one, so this reversal hands the session back
 *  (correct — the client keeps it) but the replacement booking carries no
 *  `package_grant_id` and redeems nothing. The client is never short a session,
 *  the new appointment just isn't shown as package-funded. Fix belongs with the
 *  reschedule path, which has no scheduling-service entry point yet. See
 *  proposals/2026-09-13-pos-packages-plans-s1-followups.md. */
async function reverseBookingRedemptionsInTx(
  tx: CoreTx,
  orgId: string,
  bookingId: string,
  opts: StatusChangeOpts,
): Promise<void> {
  const live = await tx
    .select({ id: posPackageRedemptions.id })
    .from(posPackageRedemptions)
    .where(
      and(
        eq(posPackageRedemptions.orgId, orgId),
        eq(posPackageRedemptions.bookingId, bookingId),
        isNull(posPackageRedemptions.reversedAt),
      ),
    );
  for (const r of live)
    await reverseRedemptionInTx(tx, orgId, r.id, {
      reason: opts.reason ?? null,
      actor: opts.actor,
    });
}

export async function setBookingStatus(
  ctx: CoreCtx,
  id: string,
  status: string,
  opts: StatusChangeOpts = {},
): Promise<void> {
  if (!SETTABLE.has(status)) throw new Error(`invalid status: ${status}`);
  await withOrgCore(ctx, async (tx) => {
    // `for update` so two clerks racing cancel/no-show on the same booking
    // serialise here — the second sees the first's status and writes neither a
    // duplicate log row nor a second reversal.
    const [current] = await tx
      .select({ status: schedBookings.status })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1)
      .for('update');
    if (!current || current.status === status) return;
    await tx
      .update(schedBookings)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)));
    await tx.insert(schedBookingStatusLog).values({
      orgId: ctx.tenantId,
      bookingId: id,
      fromStatus: current.status,
      toStatus: status,
      reason: opts.reason ?? null,
      changedBy: opts.actor?.id ?? ctx.profileId ?? null,
    });
    if (RELEASING.has(status)) await reverseBookingRedemptionsInTx(tx, ctx.tenantId, id, opts);
  });
  if (RELEASING.has(status)) {
    // Post-commit + fail-soft; idempotent, so a lost release is re-triggerable.
    // Unconditional (not gated on "the status actually changed") to keep the
    // pre-existing retry path: a release that failed last time still lands.
    try {
      await releaseAccruals(ctx, 'booking', id);
    } catch (e) {
      console.error('[scheduling] releaseAccruals failed (status change stands)', e);
    }
  }
}

/** Update a booking's own event kind (spec §1/§2.1); null clears the override
 *  back to the event type's kind. Validated as an org kind when set. */
export async function setBookingKind(
  ctx: CoreCtx,
  id: string,
  kindId: string | null,
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    if (kindId) await assertOrgEventKind(tx, ctx.tenantId, kindId);
    await tx
      .update(schedBookings)
      .set({ kindId, updatedAt: new Date() })
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)));
  });
}

/** "this one" vs "the rest of the series" (spec §3.3). */
export type CancelScope = 'one' | 'following';

/**
 * Cancel a booking, optionally taking the rest of its series with it.
 *
 * `following` = this occurrence plus every LATER `series_index` that is still
 * live; already-completed past sessions are left alone (cancelling them would
 * hand back sessions the client actually took). Returns the ids it cancelled —
 * empty means the booking doesn't exist, which is the caller's 404.
 */
export async function cancelBooking(
  ctx: CoreCtx,
  id: string,
  opts: { scope?: CancelScope } & StatusChangeOpts = {},
): Promise<string[]> {
  const targets = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: schedBookings.id,
        seriesId: schedBookings.seriesId,
        seriesIndex: schedBookings.seriesIndex,
      })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) return [];
    if (opts.scope !== 'following' || !row.seriesId || row.seriesIndex == null) return [row.id];
    const later = await tx
      .select({ id: schedBookings.id })
      .from(schedBookings)
      .where(
        and(
          eq(schedBookings.orgId, ctx.tenantId),
          eq(schedBookings.seriesId, row.seriesId),
          gt(schedBookings.seriesIndex, row.seriesIndex),
          inArray(schedBookings.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(asc(schedBookings.seriesIndex));
    return [row.id, ...later.map((r) => r.id)];
  });
  // One status change per booking: each is independently idempotent, reverses
  // its own redemption and writes its own log row.
  // TODO(handoff): a `following` cancel is N independent transactions, not one —
  // a failure on occurrence 3 leaves 1-2 cancelled (each with its session already
  // handed back, which is the safe direction) and the rest live. Retrying the
  // same call is idempotent and finishes the job, so this is a UX gap, not data
  // loss. See proposals/2026-09-13-pos-packages-plans-s1-followups.md.
  for (const target of targets) await setBookingStatus(ctx, target, 'cancelled', opts);
  return targets;
}

/** The two notes the detail drawer edits: `notes` internal, `clientNote` shown
 *  to the client. Only the keys present in `patch` are written. */
export async function updateBookingNotes(
  ctx: CoreCtx,
  id: string,
  patch: { notes?: string | null; clientNote?: string | null },
): Promise<SchedBooking | null> {
  const set: { notes?: string | null; clientNote?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if ('notes' in patch) set.notes = patch.notes ?? null;
  if ('clientNote' in patch) set.clientNote = patch.clientNote ?? null;
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(schedBookings)
      .set(set)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}

export async function getBooking(ctx: CoreCtx, id: string): Promise<SchedBooking | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export interface RescheduleBookingInput {
  start: Date;
  end: Date;
  /** Move to a different resource too (drag onto another staff column). Omit to
   *  keep the booking's current resource. */
  resourceId?: string;
}

/** Statuses a reschedule target must avoid clashing with (spec §3.2b) — wider
 *  than ACTIVE_STATUSES above (which only gates NEW-booking availability):
 *  a completed booking still occupies its resource's calendar slot. */
const CONFLICT_STATUSES = ['accepted', 'pending', 'completed'] as const;

/**
 * Drag/drop or resize a booking (spec §3.2b). Org-scoped; rejects a
 * cancelled/rejected booking, a zero/negative-length move, or an inactive/
 * foreign target resource. Conflict check reuses the same buffer-padded
 * overlap test the slot engine uses (`intervalsOverlap` in slots.ts) against
 * every other non-cancelled booking on the target resource, padded by the
 * booking's own event type buffers (mirrors how `createBooking` pads busy
 * intervals by the booked event type's buffers before slotting).
 */
export async function rescheduleBooking(
  ctx: CoreCtx,
  id: string,
  input: RescheduleBookingInput,
): Promise<SchedBooking> {
  return withOrgCore(ctx, (tx) => rescheduleBookingInTx(tx, ctx, id, input));
}

async function rescheduleBookingInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  id: string,
  input: RescheduleBookingInput,
): Promise<SchedBooking> {
  if (!(input.end.getTime() > input.start.getTime())) throw new Error('end must be after start');
  const [existing] = await tx
    .select()
    .from(schedBookings)
    .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
    .limit(1);
  if (!existing) throw new Error('booking not found');
  if (existing.status === 'cancelled' || existing.status === 'rejected')
    throw new Error(`cannot reschedule a ${existing.status} booking`);

  const resourceId = input.resourceId ?? existing.resourceId;
  if (input.resourceId) {
    const [res] = await tx
      .select({ id: schedResources.id })
      .from(schedResources)
      .where(
        and(
          eq(schedResources.id, input.resourceId),
          eq(schedResources.orgId, ctx.tenantId),
          eq(schedResources.active, true),
        ),
      )
      .limit(1);
    if (!res) throw new Error('invalid resourceId');
  }

  // Buffers come from the booking's own event type (same knobs `createBooking`
  // pads busy intervals by before handing them to the slot engine).
  const [et] = await tx
    .select({
      beforeBuffer: schedEventTypes.beforeBuffer,
      afterBuffer: schedEventTypes.afterBuffer,
    })
    .from(schedEventTypes)
    .where(eq(schedEventTypes.id, existing.eventTypeId))
    .limit(1);
  const beforeBuffer = (et?.beforeBuffer ?? 0) * MS_PER_MIN;
  const afterBuffer = (et?.afterBuffer ?? 0) * MS_PER_MIN;

  const others = await tx
    .select({
      id: schedBookings.id,
      start: schedBookings.startTime,
      end: schedBookings.endTime,
      title: schedBookings.title,
    })
    .from(schedBookings)
    .where(
      and(
        eq(schedBookings.orgId, ctx.tenantId),
        eq(schedBookings.resourceId, resourceId),
        inArray(schedBookings.status, [...CONFLICT_STATUSES]),
        ne(schedBookings.id, id),
      ),
    );
  const targetStart = input.start.getTime();
  const targetEnd = input.end.getTime();
  for (const o of others) {
    if (
      intervalsOverlap(
        targetStart,
        targetEnd,
        o.start.getTime() - beforeBuffer,
        o.end.getTime() + afterBuffer,
      )
    ) {
      throw new BookingConflictError(
        `Conflicts with "${o.title ?? 'a booking'}" from ${o.start.toISOString()} to ${o.end.toISOString()}`,
      );
    }
  }

  // TODO(handoff): spec §3.2b allows a reschedule outside working hours /
  // on a holiday / during staff leave (a human scheduler decides) — this
  // never blocks on it, but no warnings payload surfaces it either. Add a
  // `{ warnings: string[] }` return (checked against schedAvailability /
  // the org holiday+leave tables) when the calendar UI wants to show one.
  const [row] = await tx
    .update(schedBookings)
    .set({ startTime: input.start, endTime: input.end, resourceId, updatedAt: new Date() })
    .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
    .returning();
  return row;
}

export interface UpdateBookingInput {
  title?: string | null;
  notes?: string | null;
  crmContactId?: string | null;
  partyId?: string | null;
  eventTypeId?: string;
  productId?: string | null;
  resourceId?: string;
  kindId?: string | null;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  attendeePhone?: string | null;
  /** Soft bridge to fin_invoices (spec S6); null clears it. Never mandatory. */
  invoiceId?: string | null;
  /** Shallow-merged into the row's existing metadata object. */
  metadata?: Record<string, unknown>;
}

/**
 * General edit of an existing booking (spec S5): title/notes/contact/service/
 * product/resource/kind/attendee fields. A `resourceId` change is delegated to
 * `rescheduleBooking` (same start/end) so the buffer-padded conflict check
 * never gets a second implementation; the calendar's own drag/resize keeps
 * going through `rescheduleBooking` directly when the time changes too.
 */
export async function updateBooking(
  ctx: CoreCtx,
  id: string,
  patch: UpdateBookingInput,
): Promise<SchedBooking> {
  return withOrgCore(ctx, (tx) => updateBookingInTx(tx, ctx, id, patch));
}

async function updateBookingInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  id: string,
  patch: UpdateBookingInput,
): Promise<SchedBooking> {
  const [existing] = await tx
    .select()
    .from(schedBookings)
    .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
    .limit(1)
    .for('update');
  if (!existing) throw new Error('booking not found');

  const resourceChanged =
    patch.resourceId !== undefined && patch.resourceId !== existing.resourceId;
  if (resourceChanged) {
    // Same start/end — this is a reassignment, not a move. Reuses the
    // reschedule path's active-resource + buffer-padded overlap checks
    // (throws BookingConflictError on a clash) instead of duplicating them.
    await rescheduleBookingInTx(tx, ctx, id, {
      start: existing.startTime,
      end: existing.endTime,
      resourceId: patch.resourceId!,
    });
  }

  // A service (event type) change snapshots that service's product onto the
  // booking, same rule createBooking uses — unless the caller passed an
  // explicit productId of its own.
  let productId = patch.productId;
  if (patch.eventTypeId !== undefined && patch.eventTypeId !== existing.eventTypeId) {
    const [et] = await tx
      .select({ productId: schedEventTypes.productId })
      .from(schedEventTypes)
      .where(
        and(eq(schedEventTypes.id, patch.eventTypeId!), eq(schedEventTypes.orgId, ctx.tenantId)),
      )
      .limit(1);
    if (!et) throw new Error('invalid eventTypeId');
    if (productId === undefined) productId = et.productId;
  }

  // A client-supplied crmContactId must belong to this org (same guard
  // createBooking applies) — never trusted verbatim.
  if (patch.crmContactId) {
    const [hit] = await tx
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, patch.crmContactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (!hit) throw new Error('invalid crmContactId');
  }
  if (patch.kindId) await assertOrgEventKind(tx, ctx.tenantId, patch.kindId);
  // A client-supplied invoiceId must belong to this org — soft ref, no FK,
  // so nothing else enforces it (spec S6).
  if (patch.invoiceId) {
    const [hit] = await tx
      .select({ id: finInvoices.id })
      .from(finInvoices)
      .where(and(eq(finInvoices.id, patch.invoiceId), eq(finInvoices.orgId, ctx.tenantId)))
      .limit(1);
    if (!hit) throw new Error('invalid invoiceId');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const changes: FieldChange[] = [];
  const setField = (field: string, value: unknown, oldValue: unknown) => {
    if (value === (oldValue ?? null)) return;
    set[field] = value;
    changes.push({ field, label: field, old: oldValue ?? null, new: value });
  };
  if (patch.title !== undefined) setField('title', patch.title, existing.title);
  if (patch.notes !== undefined) setField('notes', patch.notes, existing.notes);
  if (patch.crmContactId !== undefined)
    setField('crmContactId', patch.crmContactId, existing.crmContactId);
  if (patch.partyId !== undefined) setField('partyId', patch.partyId, existing.partyId);
  if (patch.eventTypeId !== undefined)
    setField('eventTypeId', patch.eventTypeId, existing.eventTypeId);
  if (productId !== undefined) setField('productId', productId, existing.productId);
  if (patch.kindId !== undefined) setField('kindId', patch.kindId, existing.kindId);
  if (patch.attendeeName !== undefined)
    setField('attendeeName', patch.attendeeName, existing.attendeeName);
  if (patch.attendeeEmail !== undefined)
    setField('attendeeEmail', patch.attendeeEmail, existing.attendeeEmail);
  if (patch.attendeePhone !== undefined)
    setField('attendeePhone', patch.attendeePhone, existing.attendeePhone);
  if (patch.invoiceId !== undefined) setField('invoiceId', patch.invoiceId, existing.invoiceId);
  if (patch.metadata !== undefined) {
    set.metadata = sql`coalesce(${schedBookings.metadata}, '{}'::jsonb) || ${JSON.stringify(patch.metadata)}::jsonb`;
    changes.push({ field: 'metadata', label: 'metadata', old: null, new: patch.metadata });
  }
  if (resourceChanged)
    changes.push({
      field: 'resourceId',
      label: 'resourceId',
      old: existing.resourceId,
      new: patch.resourceId,
    });

  if (Object.keys(set).length > 1) {
    await tx
      .update(schedBookings)
      .set(set)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)));
  }
  if (changes.length) {
    await recordAuditInTx(tx, ctx, {
      refType: 'sched_booking',
      refId: id,
      op: 'update',
      changes,
      actor: { id: ctx.profileId ?? null, name: null },
    });
  }
  const [row] = await tx
    .select()
    .from(schedBookings)
    .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
    .limit(1);
  if (!row) throw new Error('booking not found');
  return row;
}

/** Apply a complete PATCH in one transaction; failure rolls back every field.
 * Stock accrual release happens only after that transaction commits. */
export async function patchBooking(
  ctx: CoreCtx,
  id: string,
  patch: UpdateBookingInput & { start?: Date; end?: Date; status?: string } & StatusChangeOpts,
): Promise<SchedBooking> {
  if ((patch.start === undefined) !== (patch.end === undefined))
    throw new Error('start and end must be provided together');
  if (patch.status !== undefined && !SETTABLE.has(patch.status))
    throw new Error(`invalid status: ${patch.status}`);
  const row = await withOrgCore(ctx, async (tx) => {
    // Lock before any component write so concurrent PATCHes cannot interleave.
    const [existing] = await tx
      .select({ id: schedBookings.id, status: schedBookings.status })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1)
      .for('update');
    if (!existing) throw new Error('booking not found');
    if (patch.start && patch.end) {
      await rescheduleBookingInTx(tx, ctx, id, {
        start: patch.start,
        end: patch.end,
        resourceId: patch.resourceId,
      });
    }
    const updated = await updateBookingInTx(tx, ctx, id, {
      ...patch,
      resourceId: patch.start ? undefined : patch.resourceId,
    });
    if (patch.status === undefined) return updated;
    const [result] = await tx
      .update(schedBookings)
      .set({ status: patch.status, updatedAt: new Date() })
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .returning();
    // Same in-tx bookkeeping `setBookingStatus` does, so a status set through
    // the general editor can't skip it: the log row, and — once packages exist —
    // handing the drawn session back to its grant. Without this a cancel via
    // PATCH would keep a redemption alive against a booking that is gone.
    if (existing.status !== patch.status) {
      await tx.insert(schedBookingStatusLog).values({
        orgId: ctx.tenantId,
        bookingId: id,
        fromStatus: existing.status,
        toStatus: patch.status,
        reason: patch.reason ?? null,
        changedBy: patch.actor?.id ?? ctx.profileId ?? null,
      });
      if (RELEASING.has(patch.status))
        await reverseBookingRedemptionsInTx(tx, ctx.tenantId, id, {
          reason: patch.reason ?? null,
          actor: patch.actor,
        });
    }
    return result;
  });
  // TODO(handoff): Admit stock release durably with the booking commit; process
  // loss between commit and this best-effort call can strand accruals. See meta
  // proposals/2026-09-12-hub-booking-stock-postcommit-recovery.md.
  if (patch.status !== undefined && RELEASING.has(patch.status)) {
    try {
      await releaseAccruals(ctx, 'booking', id);
    } catch (e) {
      console.error('[scheduling] releaseAccruals failed (status change stands)', e);
    }
  }
  return row;
}

/** Thrown by `deleteBooking` when the booking is still referenced elsewhere
 *  (a POS ticket line, a sales order, or a realized stock accrual) — the UI
 *  offers "cancel instead" for these. */
export class BookingReferencedError extends Error {
  references: Array<'ticket' | 'order' | 'accrual'>;
  constructor(references: Array<'ticket' | 'order' | 'accrual'>) {
    super(`booking is referenced by: ${references.join(', ')}`);
    this.name = 'BookingReferencedError';
    this.references = references;
  }
}

/**
 * Hard delete (spec S5) — only when nothing downstream points at this
 * booking. Open (not yet realized) accruals are released exactly like a
 * cancel does, post-commit and fail-soft, never blocking the delete itself.
 */
export async function deleteBooking(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: schedBookings.id, status: schedBookings.status })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    if (!existing) throw new Error('booking not found');

    const references: Array<'ticket' | 'order' | 'accrual'> = [];
    const [ticket] = await tx
      .select({ id: posTicketLines.id })
      .from(posTicketLines)
      .where(and(eq(posTicketLines.orgId, ctx.tenantId), eq(posTicketLines.bookingId, id)))
      .limit(1);
    if (ticket) references.push('ticket');
    const [order] = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(and(eq(salesOrders.orgId, ctx.tenantId), eq(salesOrders.sourceBookingId, id)))
      .limit(1);
    if (order) references.push('order');
    const [accrual] = await tx
      .select({ id: stkAccruals.id })
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, 'booking'),
          eq(stkAccruals.sourceId, id),
          eq(stkAccruals.status, 'realized'),
        ),
      )
      .limit(1);
    if (accrual) references.push('accrual');
    if (references.length) throw new BookingReferencedError(references);

    await tx
      .delete(tagLinks)
      .where(
        and(
          eq(tagLinks.orgId, ctx.tenantId),
          eq(tagLinks.entityKind, 'booking'),
          eq(tagLinks.entityId, id),
        ),
      );
    // sched_reminders holds only a soft reference to the booking (no FK/cascade —
    // see pg-reminders-schema.ts) so it needs its own explicit cleanup here.
    await tx
      .delete(schedReminders)
      .where(and(eq(schedReminders.orgId, ctx.tenantId), eq(schedReminders.bookingId, id)));
    // TODO(handoff): when attachment_links (spec S1) lands, delete this
    // booking's rows there too — this slice predates attachments, so none
    // can exist yet.
    await recordAuditInTx(tx, ctx, {
      refType: 'sched_booking',
      refId: id,
      op: 'delete',
      changes: [{ field: 'status', label: 'status', old: existing.status, new: 'deleted' }],
      actor: { id: ctx.profileId ?? null, name: null },
    });
    await tx
      .delete(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)));
  });
  // Post-commit, fail-soft — mirrors setBookingStatus's release-on-cancel path.
  try {
    await releaseAccruals(ctx, 'booking', id);
  } catch (e) {
    console.error('[scheduling] releaseAccruals failed (delete stands)', e);
  }
}

export interface InvoiceBookingRow {
  id: string;
  title: string | null;
  startTime: Date;
  endTime: Date;
  status: string;
  resourceName: string;
  /** 'explicit' = booking.invoice_id points here; 'ticket' = reached only via
   *  a POS ticket line's booking, transitively (spec S6). */
  via: 'explicit' | 'ticket';
}

/**
 * Bookings linked to one invoice (spec S6, invoice detail page) — the
 * explicit `sched_bookings.invoice_id` route unioned with the transitive
 * route through a reconciled POS ticket (`pos_tickets.invoice_provider_ref`
 * matches this invoice's `provider_ref`) whose lines carry a booking. An
 * explicit link always wins the `via` label when a booking has both.
 */
export async function listBookingsForInvoice(
  ctx: CoreCtx,
  invoiceId: string,
): Promise<InvoiceBookingRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx
      .select({ providerRef: finInvoices.providerRef })
      .from(finInvoices)
      .where(and(eq(finInvoices.id, invoiceId), eq(finInvoices.orgId, ctx.tenantId)))
      .limit(1);
    if (!invoice) return [];

    const cols = {
      id: schedBookings.id,
      title: schedBookings.title,
      startTime: schedBookings.startTime,
      endTime: schedBookings.endTime,
      status: schedBookings.status,
      resourceName: schedResources.name,
    };

    const explicit = await tx
      .select(cols)
      .from(schedBookings)
      .innerJoin(schedResources, eq(schedResources.id, schedBookings.resourceId))
      .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.invoiceId, invoiceId)));

    const ticketDerived = invoice.providerRef
      ? await tx
          .select(cols)
          .from(posTicketLines)
          .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
          .innerJoin(schedBookings, eq(schedBookings.id, posTicketLines.bookingId))
          .innerJoin(schedResources, eq(schedResources.id, schedBookings.resourceId))
          .where(
            and(
              eq(posTicketLines.orgId, ctx.tenantId),
              eq(posTickets.invoiceProviderRef, invoice.providerRef),
              isNotNull(posTicketLines.bookingId),
            ),
          )
      : [];

    const byId = new Map<string, InvoiceBookingRow>();
    for (const r of explicit) byId.set(r.id, { ...r, via: 'explicit' });
    for (const r of ticketDerived) if (!byId.has(r.id)) byId.set(r.id, { ...r, via: 'ticket' });
    return [...byId.values()].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  });
}

/** One occurrence of the same series, as the drawer lists them. */
export interface BookingSeriesSibling {
  id: string;
  seriesIndex: number | null;
  startTime: Date;
  endTime: Date;
  status: string;
}

/** Everything the booking detail drawer renders (spec §4.1). */
export interface BookingDetail {
  booking: SchedBooking;
  eventType: SchedEventType | null;
  resource: SchedResource | null;
  contact: { id: string; displayName: string | null } | null;
  /** Oldest first; the first row (fromStatus null) is the creation.
   *  `changedByName` is the actor's profile display name (email fallback),
   *  resolved on read — a bare uuid is worse than no actor at all. */
  statusHistory: (SchedBookingStatusLog & { changedByName: string | null })[];
  /** The package session this booking drew, with sessionsRemaining. */
  grant: GrantView | null;
  /** The instalment plan funding it, with paidToDate / remaining. */
  plan: PlanDetail | null;
  /** Null unless the booking belongs to a series. `occurrences` INCLUDES this
   *  booking, ordered by seriesIndex. */
  series: {
    seriesId: string;
    index: number | null;
    total: number;
    occurrences: BookingSeriesSibling[];
  } | null;
  /** Open/realized/released rollup of this booking's stock accruals. */
  accrual: AccrualSourceSummary | null;
  /** POS ticket lines that charged this booking (`pos_ticket_lines.booking_id`),
   *  newest first — the "was it paid?" answer. Empty when unpaid or POS off. */
  tickets: BookingTicketRef[];
}

export interface BookingTicketRef {
  ticketId: string;
  humanId: string | null;
  submittedAt: Date | null;
  status: string;
  currency: string;
  lineTotal: string;
}

/**
 * The detail payload. `getBooking` stays the cheap single-row read the complete
 * / accrual routes use; this is the drawer's read, and it deliberately fails
 * SOFT on the POS and stock facets — an org with those modules off (or tables
 * absent) must still get the appointment, not a 500.
 */
export async function getBookingDetail(
  ctx: CoreCtx,
  id: string,
  opts: { maskAttendeePii?: boolean } = {},
): Promise<BookingDetail | null> {
  const base = await withOrgCore(ctx, async (tx) => {
    const [booking] = await tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    if (!booking) return null;
    const [eventType] = await tx
      .select()
      .from(schedEventTypes)
      .where(
        and(eq(schedEventTypes.id, booking.eventTypeId), eq(schedEventTypes.orgId, ctx.tenantId)),
      )
      .limit(1);
    const [resource] = await tx
      .select()
      .from(schedResources)
      .where(and(eq(schedResources.id, booking.resourceId), eq(schedResources.orgId, ctx.tenantId)))
      .limit(1);
    const contacts = booking.crmContactId
      ? await tx
          .select({ id: crmContacts.id, displayName: crmContacts.displayName })
          .from(crmContacts)
          .where(and(eq(crmContacts.id, booking.crmContactId), eq(crmContacts.orgId, ctx.tenantId)))
          .limit(1)
      : [];
    const statusHistory = await tx
      .select()
      .from(schedBookingStatusLog)
      .where(
        and(eq(schedBookingStatusLog.orgId, ctx.tenantId), eq(schedBookingStatusLog.bookingId, id)),
      )
      .orderBy(asc(schedBookingStatusLog.changedAt));
    const occurrences = booking.seriesId
      ? await tx
          .select({
            id: schedBookings.id,
            seriesIndex: schedBookings.seriesIndex,
            startTime: schedBookings.startTime,
            endTime: schedBookings.endTime,
            status: schedBookings.status,
          })
          .from(schedBookings)
          .where(
            and(
              eq(schedBookings.orgId, ctx.tenantId),
              eq(schedBookings.seriesId, booking.seriesId),
            ),
          )
          .orderBy(asc(schedBookings.seriesIndex))
      : [];
    return {
      booking,
      eventType: eventType ?? null,
      resource: resource ?? null,
      contact: contacts[0] ?? null,
      statusHistory,
      occurrences,
    };
  });
  if (!base) return null;

  const booking = opts.maskAttendeePii
    ? {
        ...base.booking,
        attendeeEmail: base.booking.attendeeEmail
          ? maskPii(base.booking.attendeeEmail)
          : base.booking.attendeeEmail,
        attendeePhone: base.booking.attendeePhone
          ? maskPii(base.booking.attendeePhone)
          : base.booking.attendeePhone,
      }
    : base.booking;

  const grant = base.booking.packageGrantId
    ? await getGrant(ctx, base.booking.packageGrantId).catch((e: unknown) => {
        console.error('[scheduling] grant lookup failed (detail stands)', e);
        return null;
      })
    : null;
  const plan = base.booking.paymentPlanId
    ? await getPlan(ctx, base.booking.paymentPlanId).catch((e: unknown) => {
        console.error('[scheduling] plan lookup failed (detail stands)', e);
        return null;
      })
    : null;
  const accruals = await accrualSummaryForSources(ctx, 'booking', [id]).catch((e: unknown) => {
    console.error('[scheduling] accrual summary failed (detail stands)', e);
    return [] as AccrualSourceSummary[];
  });
  const tickets = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        ticketId: posTickets.id,
        humanId: posTickets.humanId,
        submittedAt: posTickets.submittedAt,
        status: posTickets.status,
        currency: posTickets.currency,
        lineTotal: posTicketLines.total,
      })
      .from(posTicketLines)
      .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
      .where(and(eq(posTicketLines.orgId, ctx.tenantId), eq(posTicketLines.bookingId, id)))
      .orderBy(desc(posTickets.submittedAt)),
  ).catch((e: unknown) => {
    console.error('[scheduling] ticket lookup failed (detail stands)', e);
    return [] as BookingTicketRef[];
  });

  // Who moved the status. `profiles` is the global identity table — outside the
  // org-scoped `withOrgCore` role, so it is read on the plain core handle, and
  // only for ids this org's own log already named. Fail-soft like every other
  // facet: an unresolved name must not cost the operator the appointment.
  const actorIds = [...new Set(base.statusHistory.map((h) => h.changedBy).filter(Boolean))];
  const actorNames = actorIds.length
    ? await ctx.db
        .select({ id: profiles.id, displayName: profiles.displayName, email: profiles.email })
        .from(profiles)
        .where(inArray(profiles.id, actorIds as string[]))
        .then((rows) => new Map(rows.map((r) => [r.id, r.displayName || r.email || null])))
        .catch((e: unknown) => {
          console.error('[scheduling] actor lookup failed (detail stands)', e);
          return new Map<string, string | null>();
        })
    : new Map<string, string | null>();

  return {
    booking,
    eventType: base.eventType,
    resource: base.resource,
    contact: base.contact,
    statusHistory: base.statusHistory.map((h) => ({
      ...h,
      changedByName: h.changedBy ? (actorNames.get(h.changedBy) ?? null) : null,
    })),
    grant,
    plan,
    series: base.booking.seriesId
      ? {
          seriesId: base.booking.seriesId,
          index: base.booking.seriesIndex,
          total: base.occurrences.length,
          occurrences: base.occurrences,
        }
      : null,
    accrual: accruals[0] ?? null,
    tickets,
  };
}
