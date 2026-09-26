import {
  and,
  eq,
  ne,
  inArray,
  notInArray,
  gt,
  gte,
  isNull,
  isNotNull,
  lte,
  asc,
  desc,
  sql,
} from 'drizzle-orm';
import { getTagLinks, getContactTagsBulk } from './tag-links.service';
import { mergeTags } from '$lib/tags/inherit';
import type { CalTag } from '$lib/components/scheduling/calendar/types';
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

/** One booking a reschedule would land on top of. */
export interface BookingConflict {
  id: string;
  title: string | null;
  /** ISO instants — the wire shape; the UI formats them in the viewer's locale. */
  start: string;
  end: string;
  resourceId: string;
}

/** Thrown by `rescheduleBooking` when the target resource/time clashes with
 *  another booking (buffer-padded). `message` names the first clashing time (kept
 *  verbatim for older clients / toasts); `conflicts` carries EVERY clash so the
 *  calendar can name them in a dialog and offer "Move anyway". */
export class BookingConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: BookingConflict[] = [],
  ) {
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

  // A client-supplied crmContactId must belong to THIS org — validate under the
  // RLS-scoped tx (don't trust it as authoritative; ignore foreign/stale ids and
  // fall back to resolve/create by phone/email).
  let crmContactId: string | null = null;
  if (input.crmContactId) {
    const [hit] = await tx
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.id, input.crmContactId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (hit) crmContactId = hit.id;
  }
  // The party-spine pick is stored on the booking too (not only resolved to a
  // contact and dropped): the POS handoff, the accounts view and the customer
  // card all key on `partyId`, and a booking that only remembered its contact
  // reached the till as a ticket-only name — no account, no document, no plan.
  // Validated in-org like the contact id above.
  let partyId: string | null = null;
  if (input.partyId) {
    const [p] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.orgId, ctx.tenantId)))
      .limit(1);
    partyId = p?.id ?? null;
  }
  if (!crmContactId && partyId) {
    const [hit] = await tx
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(and(eq(crmContacts.partyId, partyId), eq(crmContacts.orgId, ctx.tenantId)))
      .limit(1);
    if (hit) crmContactId = hit.id;
  }
  if (!crmContactId)
    crmContactId = await ensureCrmContact(
      tx,
      ctx.tenantId,
      input.attendeeName,
      input.attendeePhone,
      input.attendeeEmail,
    );

  // Same rule as crmContactId: a client-supplied plan id is a hint, not
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
 *   · the `pos_ticket_lines.booking_id` claim, which only fires while the
 *     column `is null`.
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
      .select({ status: posTickets.status, partyId: posTickets.partyId })
      .from(posTickets)
      .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.id, input.ticketId)))
      .limit(1);
    // Org-scoped read: a foreign ticket id is "not found", never someone else's row.
    if (!ticket) throw new PosError('ticket not found', 'not_found');
    // BUG (2026-09-16 lifecycle-b QA): this compared against 'voided', but
    // voidTicket persists status 'void' (pos.service.ts) — the check could
    // never fire, so a voided ticket could still be scheduled after reload.
    if (ticket.status === 'void') throw new PosError('ticket is void', 'ticket_void');

    const [line] = await tx
      .select({ kind: posTicketLines.kind, bookingId: posTicketLines.bookingId })
      .from(posTicketLines)
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.id, input.lineId),
          eq(posTicketLines.ticketId, input.ticketId),
        ),
      )
      .limit(1);
    if (!line) throw new PosError('line not found', 'not_found');
    if (line.kind !== 'service') throw new PosError('line is not a service', 'line_not_service');

    if (line.bookingId) {
      const [existing] = await tx
        .select()
        .from(schedBookings)
        .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.id, line.bookingId)))
        .limit(1);
      // Replay of the same submit → the same appointment, 200, nothing created.
      if (existing && !DEAD_BOOKING_STATUSES.has(existing.status))
        return { booking: existing, created: false };
      // Linked to a cancelled/rejected (or vanished) booking: the line is stuck
      // and the `is null` claim below could never fire — say so explicitly.
      throw new PosError('line already scheduled', 'line_already_scheduled');
    }

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

    // A walk-in ticket (no party at sale time) can pick/create a customer here
    // in the scheduling step. Stamp the ticket with that party so it is linked
    // the same as a sale that had a customer from the start — not just the
    // booking. Never overwrites an existing party.
    if (!ticket.partyId && input.partyId) {
      await tx
        .update(posTickets)
        .set({
          partyId: input.partyId,
          ...(input.attendeeName ? { customerName: input.attendeeName } : {}),
        })
        .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.id, input.ticketId)));
    }

    const booked = await bookOccurrenceInTx(
      tx,
      ctx,
      { ...input, attendeePhone },
      { start: input.start, today },
    );

    const [claimed] = await tx
      .update(posTicketLines)
      .set({ bookingId: booked.row.id })
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.id, input.lineId),
          eq(posTicketLines.ticketId, input.ticketId),
          isNull(posTicketLines.bookingId),
        ),
      )
      .returning({ id: posTicketLines.id });
    // Lost the race for the line → the booking just inserted goes back with it.
    if (!claimed) throw new PosError('line already scheduled', 'line_already_scheduled');

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
  /**
   * Land the move even though it clashes (the calendar's "Move anyway" after the
   * conflict dialog). Mirrors `createBooking`'s own `overrideConflicts`, minus
   * its `forceResourceId` requirement: a move already names its target resource
   * explicitly, so there is no slot search to bypass.
   */
  overrideConflicts?: boolean;
}

/** Statuses a reschedule target must avoid clashing with (spec §3.2b) — wider
 *  than ACTIVE_STATUSES above (which only gates NEW-booking availability):
 *  a completed booking still occupies its resource's calendar slot. */
const CONFLICT_STATUSES = ['accepted', 'pending', 'completed'] as const;

/**
 * Every booking on `resourceId` a `[start, end)` placement would land on,
 * buffer-padded by `eventTypeId`'s own before/after buffers (the same knobs
 * `createBooking` pads busy intervals by before slotting). `excludeIds` are the
 * rows being placed; `groupId` exempts the rest of one merged visit, whose
 * members are deliberately co-timed with each other.
 *
 * The one implementation — `rescheduleBookingInTx`, `groupBookingWith`,
 * `moveGroup` and `ungroupBooking` all call it, so a merged visit can never be
 * checked by a second, differently-behaving rule.
 */
async function findBookingConflicts(
  tx: CoreTx,
  ctx: CoreCtx,
  opts: {
    resourceId: string;
    start: Date;
    end: Date;
    eventTypeId: string;
    excludeIds: string[];
    groupId?: string | null;
  },
): Promise<BookingConflict[]> {
  const [et] = await tx
    .select({
      beforeBuffer: schedEventTypes.beforeBuffer,
      afterBuffer: schedEventTypes.afterBuffer,
    })
    .from(schedEventTypes)
    .where(eq(schedEventTypes.id, opts.eventTypeId))
    .limit(1);
  const beforeBuffer = (et?.beforeBuffer ?? 0) * MS_PER_MIN;
  const afterBuffer = (et?.afterBuffer ?? 0) * MS_PER_MIN;

  const others = await tx
    .select({
      id: schedBookings.id,
      start: schedBookings.startTime,
      end: schedBookings.endTime,
      title: schedBookings.title,
      metadata: schedBookings.metadata,
    })
    .from(schedBookings)
    .where(
      and(
        eq(schedBookings.orgId, ctx.tenantId),
        eq(schedBookings.resourceId, opts.resourceId),
        inArray(schedBookings.status, [...CONFLICT_STATUSES]),
        opts.excludeIds.length === 1
          ? ne(schedBookings.id, opts.excludeIds[0])
          : notInArray(schedBookings.id, opts.excludeIds),
      ),
    );
  const targetStart = opts.start.getTime();
  const targetEnd = opts.end.getTime();
  const conflicts: BookingConflict[] = [];
  for (const o of others) {
    if (opts.groupId && groupIdOf(o.metadata) === opts.groupId) continue;
    if (
      intervalsOverlap(
        targetStart,
        targetEnd,
        o.start.getTime() - beforeBuffer,
        o.end.getTime() + afterBuffer,
      )
    ) {
      conflicts.push({
        id: o.id,
        title: o.title ?? null,
        start: o.start.toISOString(),
        end: o.end.toISOString(),
        resourceId: opts.resourceId,
      });
    }
  }
  return conflicts;
}

/** The single-line message older clients/toasts read off a 409. */
function conflictMessage(conflicts: BookingConflict[]): string {
  const first = conflicts[0];
  return `Conflicts with "${first.title ?? 'a booking'}" from ${first.start} to ${first.end}`;
}

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

  const conflicts = await findBookingConflicts(tx, ctx, {
    resourceId,
    start: input.start,
    end: input.end,
    eventTypeId: existing.eventTypeId,
    excludeIds: [id],
    // Members of the SAME merged visit never clash with each other: a merged
    // visit is deliberately co-timed (and was back-to-back before #370), so its
    // own buffers must not apply inside it. Legacy back-to-back groups still
    // depend on this while a member moves one row at a time.
    groupId: groupIdOf(existing.metadata),
  });
  if (conflicts.length && !input.overrideConflicts)
    throw new BookingConflictError(conflictMessage(conflicts), conflicts);

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

/** `metadata.groupId` of a booking row, or null. The one reader of the shape. */
function groupIdOf(metadata: unknown): string | null {
  const id = (metadata as { groupId?: unknown } | null)?.groupId;
  return typeof id === 'string' && id ? id : null;
}

/** Who a booking is for — the identity both sides of a merge must share. The id
 *  column wins over the free-text name (two walk-in "Ana"s are not one visit).
 *  Mirrors `clientKeyOf` in `$lib/components/scheduling/booking-groups.ts`,
 *  which the calendar uses to decide whether to even OFFER the merge. */
function clientKeyOfRow(b: {
  partyId: string | null;
  crmContactId: string | null;
  attendeeName: string | null;
}): string | null {
  if (b.partyId) return `p:${b.partyId}`;
  if (b.crmContactId) return `c:${b.crmContactId}`;
  const name = b.attendeeName?.trim().toLowerCase();
  return name ? `n:${name}` : null;
}

/**
 * A merged visit ("container") is VIRTUAL — no row of its own. Its members are
 * the bookings sharing `metadata.groupId` on one resource, and since #370 they
 * all carry the SAME `start_time`/`end_time`: the container WINDOW. The window
 * is free to be any length; each member remembers what it was worth on its own:
 *
 *   `groupId`     — the visit
 *   `groupSeq`    — order inside it (0 = lead)
 *   `groupLength` — the member's ORIGINAL duration in minutes, restored when it
 *                   leaves the visit
 *
 * Owner ask 2026-09-25: "The container event can take on any duration without
 * worrying about the durations of its nested events. When the nested events are
 * separated, they take on their original durations pre-merge. A container event
 * can't hold a single event."
 *
 * Legacy #369 groups (back-to-back members, no seq/length stamps) still read and
 * render: every helper below falls back to a row's own current duration and to
 * (start, id) ordering, and the first `moveGroup`/merge normalises the group.
 */
interface GroupRow {
  id: string;
  startTime: Date;
  endTime: Date;
  metadata: unknown;
}

/** `metadata.groupSeq`, or null on a legacy/ungrouped row. */
function groupSeqOf(metadata: unknown): number | null {
  const n = (metadata as { groupSeq?: unknown } | null)?.groupSeq;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Minutes. The stamped original duration, or — for a legacy row that never got
 *  one — the row's own current duration, which is what it was worth back when
 *  members were laid back-to-back. */
function groupLengthOf(row: GroupRow): number {
  const n = (row.metadata as { groupLength?: unknown } | null)?.groupLength;
  if (typeof n === 'number' && n > 0) return n;
  return durationMin(row);
}

function durationMin(row: GroupRow): number {
  return Math.max(1, Math.round((row.endTime.getTime() - row.startTime.getTime()) / MS_PER_MIN));
}

/** Visit order: the stamped `groupSeq`, then start time, then id. Unstamped rows
 *  sort after stamped ones, which is only reachable on half-migrated data. */
function sortGroupMembers<T extends GroupRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (groupSeqOf(a.metadata) ?? Number.MAX_SAFE_INTEGER) -
        (groupSeqOf(b.metadata) ?? Number.MAX_SAFE_INTEGER) ||
      a.startTime.getTime() - b.startTime.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/** The container window every member of a visit shares. */
export interface GroupWindow {
  start: Date;
  end: Date;
}

/** What one member must end up carrying: its place in the visit and what it is
 *  worth on its own. */
export interface GroupStamp {
  id: string;
  seq: number;
  length: number;
}

/**
 * Where a merge lands, as pure math (no db): `members` are the visit `moved`
 * joins (just the target when it is still ungrouped), `moved` is the dragged
 * booking. The window keeps the visit's start and GROWS by the moved booking's
 * own duration — the owner's "the container events take both their places".
 * Every member is (re)stamped, which is also what normalises a legacy group.
 */
export function planGroupMerge(
  members: GroupRow[],
  moved: GroupRow,
): { window: GroupWindow; stamps: GroupStamp[] } {
  const ordered = sortGroupMembers(members);
  const startMs = Math.min(...ordered.map((m) => m.startTime.getTime()));
  const endMs = Math.max(...ordered.map((m) => m.endTime.getTime()));
  const stamps = ordered.map((m, i) => ({
    id: m.id,
    seq: groupSeqOf(m.metadata) ?? i,
    length: groupLengthOf(m),
  }));
  const maxSeq = stamps.reduce((max, s) => Math.max(max, s.seq), -1);
  const movedLength = durationMin(moved);
  stamps.push({ id: moved.id, seq: maxSeq + 1, length: movedLength });
  return {
    window: { start: new Date(startMs), end: new Date(endMs + movedLength * MS_PER_MIN) },
    stamps,
  };
}

/** One row's placement after a separation. `seq === null` = it LEAVES the visit
 *  (all three metadata keys are dropped); a number = it stays, re-seqed. */
export interface UngroupPlacement {
  id: string;
  start: Date;
  end: Date;
  seq: number | null;
}

/**
 * Where a separation lands, as pure math (no db). `detachId` is the member the
 * user pulled out.
 *
 * - 2 members or fewer: the container is DESTROYED — both become top-level and
 *   are laid out from the window start in seq order, each with its own restored
 *   `groupLength` ("a container event can't hold a single event").
 * - 3 or more: only `detachId` leaves, restored at the window END (the first
 *   free instant the container itself vouches for); the rest keep the window and
 *   are re-seqed 0..n-1.
 */
export function planGroupSeparate(
  members: GroupRow[],
  detachId: string,
): { destroyed: boolean; rows: UngroupPlacement[] } {
  const ordered = sortGroupMembers(members);
  const windowStart = Math.min(...ordered.map((m) => m.startTime.getTime()));
  const windowEnd = Math.max(...ordered.map((m) => m.endTime.getTime()));
  if (ordered.length <= 2) {
    let cursor = windowStart;
    const rows = ordered.map((m) => {
      const len = groupLengthOf(m) * MS_PER_MIN;
      const row = { id: m.id, start: new Date(cursor), end: new Date(cursor + len), seq: null };
      cursor += len;
      return row;
    });
    return { destroyed: true, rows };
  }
  const detached = ordered.find((m) => m.id === detachId);
  if (!detached) throw new Error('booking is not a member of this visit');
  const rest = ordered.filter((m) => m.id !== detachId);
  return {
    destroyed: false,
    rows: [
      {
        id: detached.id,
        start: new Date(windowEnd),
        end: new Date(windowEnd + groupLengthOf(detached) * MS_PER_MIN),
        seq: null,
      },
      ...rest.map((m, i) => ({
        id: m.id,
        start: new Date(windowStart),
        end: new Date(windowEnd),
        seq: i,
      })),
    ],
  };
}

/** Write one member: the window (and resource, when the visit changed column)
 *  plus its stamps — or, with `stamp: null`, its restored own time and no group
 *  keys at all. `updatedAt` parity with `rescheduleBookingInTx`, which likewise
 *  emits no event and touches no accrual (a time change is not a consumption
 *  change). */
async function writeGroupMember(
  tx: CoreTx,
  ctx: CoreCtx,
  placement: { id: string; start: Date; end: Date; resourceId?: string },
  stamp: { groupId: string; seq: number; length: number } | null,
): Promise<void> {
  await tx
    .update(schedBookings)
    .set({
      startTime: placement.start,
      endTime: placement.end,
      ...(placement.resourceId ? { resourceId: placement.resourceId } : {}),
      metadata: stamp
        ? sql`coalesce(${schedBookings.metadata}, '{}'::jsonb) || ${JSON.stringify({
            groupId: stamp.groupId,
            groupSeq: stamp.seq,
            groupLength: stamp.length,
          })}::jsonb`
        : GROUP_KEYS_STRIPPED,
      updatedAt: new Date(),
    })
    .where(and(eq(schedBookings.id, placement.id), eq(schedBookings.orgId, ctx.tenantId)));
}

const GROUP_KEYS_STRIPPED = sql`coalesce(${schedBookings.metadata}, '{}'::jsonb) - 'groupId' - 'groupSeq' - 'groupLength'`;

/** Every member of one visit, locked. Cancelled/rejected rows are not members:
 *  they do not render in the box and must not be dragged along. */
function selectGroupMembers(tx: CoreTx, ctx: CoreCtx, groupId: string, resourceId?: string) {
  return tx
    .select({
      id: schedBookings.id,
      startTime: schedBookings.startTime,
      endTime: schedBookings.endTime,
      metadata: schedBookings.metadata,
      eventTypeId: schedBookings.eventTypeId,
      resourceId: schedBookings.resourceId,
    })
    .from(schedBookings)
    .where(
      and(
        eq(schedBookings.orgId, ctx.tenantId),
        sql`${schedBookings.metadata} ->> 'groupId' = ${groupId}`,
        inArray(schedBookings.status, [...CONFLICT_STATUSES]),
        ...(resourceId ? [eq(schedBookings.resourceId, resourceId)] : []),
      ),
    )
    .for('update');
}

/** `metadata.groupId` of one booking — how the `/group` route turns the dragged
 *  member's id into the visit `moveGroup` moves (400 when it is null). */
export async function bookingGroupId(ctx: CoreCtx, id: string): Promise<string | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ metadata: schedBookings.metadata })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    return row ? groupIdOf(row.metadata) : null;
  });
}

/**
 * Merge `id` into the visit `withId` belongs to (owner ask 2026-09-25: dragging
 * an event onto another one for the same client and team member joins them into
 * a single block).
 *
 * All members end up on the SHARED WINDOW `[visit start, visit end + moved
 * duration]` with `groupId`/`groupSeq`/`groupLength` stamped, in ONE transaction
 * with the rows locked `for update`. The window is conflict-checked ONCE against
 * non-members on the resource; a clash throws `BookingConflictError` (the
 * calendar's conflict dialog) and there is deliberately no override for a merge —
 * the user can move the visit first. Rejects a cross-resource or cross-client
 * merge: the drag UI only offers it for matching pairs, but this is the trust
 * boundary.
 */
export async function groupBookingWith(
  ctx: CoreCtx,
  id: string,
  withId: string,
): Promise<{ groupId: string }> {
  if (id === withId) throw new Error('cannot merge a booking with itself');
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.orgId, ctx.tenantId), inArray(schedBookings.id, [id, withId])))
      .for('update');
    const moved = rows.find((r) => r.id === id);
    const target = rows.find((r) => r.id === withId);
    if (!moved || !target) throw new Error('booking not found');
    if (moved.resourceId !== target.resourceId) throw new Error('a merged visit is one resource');
    const key = clientKeyOfRow(moved);
    if (!key || key !== clientKeyOfRow(target)) throw new Error('a merged visit is one client');

    const targetGroupId = groupIdOf(target.metadata);
    const groupId = targetGroupId ?? crypto.randomUUID();
    // The visit as it stands: the target alone, or every row already sharing its
    // groupId on that resource (the moved row is never one of them).
    const siblings = targetGroupId
      ? (await selectGroupMembers(tx, ctx, groupId, target.resourceId)).filter((m) => m.id !== id)
      : [];
    const members: GroupRow[] = siblings.length ? siblings : [target];

    const { window, stamps } = planGroupMerge(members, moved);
    const conflicts = await findBookingConflicts(tx, ctx, {
      resourceId: target.resourceId,
      start: window.start,
      end: window.end,
      eventTypeId: moved.eventTypeId,
      excludeIds: stamps.map((s) => s.id),
      groupId,
    });
    if (conflicts.length) throw new BookingConflictError(conflictMessage(conflicts), conflicts);

    for (const s of stamps)
      await writeGroupMember(
        tx,
        ctx,
        { id: s.id, start: window.start, end: window.end },
        { groupId, seq: s.seq, length: s.length },
      );
    return { groupId };
  });
}

export interface MoveGroupInput {
  start: Date;
  end: Date;
  /** Move the whole visit to another staff column too. */
  resourceId?: string;
  /** "Move anyway" after the calendar's conflict dialog. */
  overrideConflicts?: boolean;
}

/** A container can be dragged/resized to any length, but not to nothing — the
 *  calendar's own snap grid is 5 minutes. */
const MIN_GROUP_WINDOW_MIN = 5;

/**
 * Drag or resize a whole merged visit: every member of `groupId` gets the same
 * window (and resource) in ONE transaction, with ONE conflict check for the
 * window against non-members. This is what makes a container behave like a
 * single event — the old N-sequential-reschedules path made the box expand and
 * contract between PATCHes, and shrinking it below the last member's start threw
 * "end must be after start".
 *
 * Side-effect parity with `rescheduleBookingInTx`: `updatedAt` only. That path
 * emits no hub event and touches no accrual either (accruals follow consumption
 * and status, not time), so there is nothing else to mirror.
 */
export async function moveGroup(
  ctx: CoreCtx,
  groupId: string,
  input: MoveGroupInput,
): Promise<{ moved: number }> {
  if (!(input.end.getTime() > input.start.getTime())) throw new Error('end must be after start');
  if (input.end.getTime() - input.start.getTime() < MIN_GROUP_WINDOW_MIN * MS_PER_MIN)
    throw new Error(`a visit is at least ${MIN_GROUP_WINDOW_MIN} minutes long`);
  return withOrgCore(ctx, async (tx) => {
    const members = await selectGroupMembers(tx, ctx, groupId);
    if (!members.length) throw new Error('visit not found');
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
    const ordered = sortGroupMembers(members);
    const resourceId = input.resourceId ?? ordered[0].resourceId;
    const conflicts = await findBookingConflicts(tx, ctx, {
      resourceId,
      start: input.start,
      end: input.end,
      // The lead's buffers speak for the visit — it is the member whose service
      // opens the block, exactly as when it was still a booking of its own.
      // TODO(handoff): a NON-lead member with wider buffers is therefore not
      // padded (same in `groupBookingWith`, which uses the moved row's). The
      // honest rule is max(beforeBuffer) / max(afterBuffer) over the members —
      // one extra `in`-query in `findBookingConflicts`. Harmless while FACES runs
      // 5/5 on every service; fix before per-service buffers diverge.
      eventTypeId: ordered[0].eventTypeId,
      excludeIds: ordered.map((m) => m.id),
      groupId,
    });
    if (conflicts.length && !input.overrideConflicts)
      throw new BookingConflictError(conflictMessage(conflicts), conflicts);

    for (const [i, m] of ordered.entries())
      await writeGroupMember(
        tx,
        ctx,
        { id: m.id, start: input.start, end: input.end, resourceId },
        // `groupLengthOf` is read BEFORE the write, so a legacy row's pre-move
        // duration is what gets stamped — otherwise the shared window would
        // become its "original" length and a later separation would restore the
        // whole visit's duration to every member.
        { groupId, seq: groupSeqOf(m.metadata) ?? i, length: groupLengthOf(m) },
      );
    return { moved: ordered.length };
  });
}

/**
 * Take one booking out of its merged visit (the calendar's "Separate"), restoring
 * pre-merge durations per `planGroupSeparate`: 2 members destroy the container,
 * 3+ detach just this one at the window end. Idempotent on an ungrouped booking.
 *
 * The restored placement is conflict-checked against non-members (it reaches
 * past the container window), so the calendar can show its dialog; "Move anyway"
 * retries with `overrideConflicts`.
 */
export async function ungroupBooking(
  ctx: CoreCtx,
  id: string,
  opts: { overrideConflicts?: boolean } = {},
): Promise<{ destroyed: boolean }> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: schedBookings.id,
        metadata: schedBookings.metadata,
        resourceId: schedBookings.resourceId,
      })
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) throw new Error('booking not found');
    const groupId = groupIdOf(row.metadata);
    if (!groupId) {
      // Nothing to leave; still strip stale stamps so the row is clean.
      await tx
        .update(schedBookings)
        .set({ metadata: GROUP_KEYS_STRIPPED, updatedAt: new Date() })
        .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)));
      return { destroyed: false };
    }
    const members = await selectGroupMembers(tx, ctx, groupId, row.resourceId);
    const byId = new Map(members.map((m) => [m.id, m]));
    if (!byId.has(id)) throw new Error('booking is not a member of this visit');

    const plan = planGroupSeparate(members, id);
    const memberIds = members.map((m) => m.id);
    const conflicts: BookingConflict[] = [];
    // Only the rows that LEAVE can clash: whoever keeps the window keeps a
    // placement the container already occupied.
    for (const r of plan.rows) {
      if (r.seq !== null) continue;
      conflicts.push(
        ...(await findBookingConflicts(tx, ctx, {
          resourceId: row.resourceId,
          start: r.start,
          end: r.end,
          eventTypeId: byId.get(r.id)!.eventTypeId,
          excludeIds: memberIds,
          groupId,
        })),
      );
    }
    if (conflicts.length && !opts.overrideConflicts) {
      const seen = new Set<string>();
      const unique = conflicts.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      throw new BookingConflictError(conflictMessage(unique), unique);
    }

    for (const r of plan.rows)
      await writeGroupMember(
        tx,
        ctx,
        { id: r.id, start: r.start, end: r.end },
        r.seq === null ? null : { groupId, seq: r.seq, length: groupLengthOf(byId.get(r.id)!) },
      );
    return { destroyed: plan.destroyed };
  });
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
  patch: UpdateBookingInput & {
    start?: Date;
    end?: Date;
    status?: string;
    /** Land a clashing move anyway — the calendar's "Move anyway". */
    overrideConflicts?: boolean;
  } & StatusChangeOpts,
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
        overrideConflicts: patch.overrideConflicts,
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
  contact: { id: string; displayName: string | null; partyId: string | null } | null;
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
  /** Own event tags + the client's CRM tags + the service's catalog tags (read-only there). */
  tags: { own: CalTag[]; contact: CalTag[]; service: CalTag[] };
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
          .select({
            id: crmContacts.id,
            displayName: crmContacts.displayName,
            partyId: crmContacts.partyId,
          })
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

  const noTags = new Map<string, CalTag[]>();
  const [ownTags, eventTypeTags, productTags, contactTags] = await Promise.all([
    getTagLinks(ctx, 'booking', [id]),
    getTagLinks(ctx, 'event_type', [booking.eventTypeId]),
    booking.productId ? getTagLinks(ctx, 'product', [booking.productId]) : noTags,
    booking.crmContactId ? getContactTagsBulk(ctx, [booking.crmContactId]) : noTags,
  ]).catch((e: unknown) => {
    console.error('[scheduling] tag lookup failed (detail stands)', e);
    return [noTags, noTags, noTags, noTags] as const;
  });

  return {
    booking,
    eventType: base.eventType,
    resource: base.resource,
    contact: base.contact,
    tags: {
      own: ownTags.get(id) ?? [],
      contact: booking.crmContactId ? (contactTags.get(booking.crmContactId) ?? []) : [],
      service: mergeTags(
        eventTypeTags.get(booking.eventTypeId) ?? [],
        booking.productId ? (productTags.get(booking.productId) ?? []) : [],
      ),
    },
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
