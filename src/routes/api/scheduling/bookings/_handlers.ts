import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import {
  createBooking,
  createBookingGroup,
  MAX_GROUP_MEMBERS,
  patchBooking,
  cancelBooking,
  getBooking,
  getBookingDetail,
  SlotUnavailableError,
  BookingConflictError,
  groupBookingWith,
  ungroupBooking,
  moveGroup,
  bookingGroupId,
  reorderVisit,
  addServiceToVisit,
  removeServiceFromVisit,
  visitMembers,
  ACTIVE_STATUSES,
  BookingReferencedError,
} from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';
import { rethrowPosError } from '../_errors';

/**
 * Booking create / detail / patch handler bodies, shared by
 * `/api/scheduling/bookings*` (scheduling capabilities) and
 * `/api/pos/appointments*` (POS capabilities). The POS calendar is a POS
 * surface: a cashier with `pos:create`/`pos:edit` but no scheduling role must
 * still be able to book, reschedule and close an UNLINKED appointment there
 * (owner 2026-09-20). Each route keeps its own auth + module gate and hands
 * the request here; the module check for `scheduling` is the caller's too.
 */
type Locals = App.Locals;

const postSchema = z.object({
  eventTypeId: z.string().min(1).max(200),
  /** The procedures of ONE container visit, in pick order (`eventTypeId` is its
   *  lead). Two or more switches the create to `createBookingGroup`; absent or a
   *  single id leaves the plain single-booking path untouched. */
  eventTypeIds: z.array(z.string().min(1).max(200)).max(MAX_GROUP_MEMBERS).optional(),
  start: z.coerce.date(),
  attendeeName: z.string().max(500).nullable().optional(),
  attendeeEmail: z.string().max(500).nullable().optional(),
  attendeePhone: z.string().max(500).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  partyId: z.string().max(200).nullable().optional(),
  resourceId: z.string().max(200).nullable().optional(),
  kindId: z.string().max(200).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  forceResourceId: z.string().max(200).optional(),
  overrideConflicts: z.boolean().optional(),
  consumption: z
    .array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() }))
    .nullable()
    .optional(),
  // Session package / instalment plan links (spec §3.2, §3.4). A grant redeems
  // one session inside the booking transaction.
  packageGrantId: z.string().uuid().nullable().optional(),
  paymentPlanId: z.string().uuid().nullable().optional(),
  clientNote: z.string().max(20_000).nullable().optional(),
});

export async function createBookingResponse(
  ctx: CoreCtx,
  locals: Locals,
  request: Request,
): Promise<Response> {
  const b = await parseBody(request, postSchema);
  try {
    const shared = {
      start: b.start,
      attendeeName: b.attendeeName ?? null,
      attendeeEmail: b.attendeeEmail ?? null,
      attendeePhone: b.attendeePhone ?? null,
      notes: b.notes ?? null,
      crmContactId: b.crmContactId ?? null,
      partyId: b.partyId ?? null,
      preferredResourceId: b.resourceId ?? null,
      kindId: b.kindId ?? null,
      title: b.title ?? null,
      metadata: b.metadata,
      source: 'internal' as const,
      bypassRules: true,
      consumption: b.consumption ?? null,
      forceResourceId: b.forceResourceId ?? undefined,
      overrideConflicts: b.overrideConflicts ?? undefined,
      packageGrantId: b.packageGrantId ?? null,
      paymentPlanId: b.paymentPlanId ?? null,
      clientNote: b.clientNote ?? null,
      actor: {
        id: ctx.profileId ?? null,
        name: locals.user?.displayName ?? locals.user?.email ?? null,
      },
    };
    // Two or more procedures = ONE container visit. The lead member is what the
    // caller gets back: it carries the start the UI redirects the calendar to,
    // and the calendar resolves the rest of the visit from `metadata.groupId`.
    if (b.eventTypeIds && b.eventTypeIds.length > 1) {
      const members = await createBookingGroup(ctx, { ...shared, eventTypeIds: b.eventTypeIds });
      return json({ booking: members[0], members: members.length });
    }
    const booking = await createBooking(ctx, { ...shared, eventTypeId: b.eventTypeId });
    return json({ booking });
  } catch (e) {
    if (e instanceof BookingConflictError)
      throw error(409, { message: e.message, code: 'slot_unavailable' });
    if (e instanceof SlotUnavailableError)
      throw error(409, {
        message: e.reason === 'resource_not_assigned' ? e.message : 'slot unavailable',
        code: e.reason,
      });
    if (
      e instanceof Error &&
      (e.message === 'overrideConflicts requires forceResourceId' || e.message === 'invalid kindId')
    )
      throw error(400, e.message);
    rethrowPosError(e);
  }
}

export async function bookingDetailResponse(
  ctx: CoreCtx,
  locals: Locals,
  id: string,
): Promise<Response> {
  const detail = await getBookingDetail(ctx, id, {
    maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
  });
  if (!detail) throw error(404, 'booking not found');
  return json(detail);
}

/** Trimmed nullable string: '' and missing both collapse to null (spec S5 —
 *  "empty → null for nullable columns"). */
const trimmedNullable = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : v),
    z.string().max(max).nullable().optional(),
  );

// Mirrors SETTABLE in scheduling-bookings.service.ts. `status`/`kindId` are a
// plain edit; `start`+`end` (both or neither — the refine below) drive a
// drag/drop or resize reschedule (spec §3.2b), `resourceId` with them moves the
// booking to another staff column too. The general-edit fields (spec S5) cover
// everything else `updateBooking` accepts. At least one recognized field must
// be present.
const patchSchema = z
  .object({
    status: z
      .enum(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show'])
      .optional(),
    kindId: z.string().max(200).nullable().optional(),
    /** Cancellation only: 'following' takes every later occurrence of the series
     *  with it (spec §3.3). Ignored for any other status. */
    scope: z.enum(['one', 'following']).optional(),
    /** Stored on the sched_booking_status_log row (and on the package reversal). */
    reason: z.string().max(2000).nullable().optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
    resourceId: z.string().max(200).optional(),
    title: trimmedNullable(200),
    notes: trimmedNullable(4000),
    crmContactId: z.string().max(200).nullable().optional(),
    partyId: z.string().max(200).nullable().optional(),
    eventTypeId: z.string().max(200).optional(),
    productId: z.string().max(200).nullable().optional(),
    attendeeName: trimmedNullable(200),
    attendeeEmail: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() || null : v),
      z.string().max(320).email().nullable().optional(),
    ),
    attendeePhone: trimmedNullable(32),
    invoiceId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Land a clashing `start`/`end` move anyway — the calendar's "Move anyway"
     *  after its conflict dialog. Mirrors the create path's own flag; a move
     *  names its target resource explicitly, so no `forceResourceId` is needed. */
    overrideConflicts: z.boolean().optional(),
  })
  .refine((b) => (b.start === undefined) === (b.end === undefined), {
    message: 'start and end must be provided together',
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

type StockWarning = { code: string; message: string; draftEntryId?: string } | null;

export interface ApplyBookingStatusResult {
  booking: Awaited<ReturnType<typeof patchBooking>> | null;
  /** Ids `cancelBooking` actually cancelled — empty means the id matched nothing. */
  cancelled: string[];
  stockWarning: StockWarning;
}

/**
 * Apply ONE `PATCH /[id]` body to ONE booking row: the status change (and the
 * general-editor fields), plus the realization a `completed` drags along. The
 * single place that knows how a row's status moves — `patchBookingResponse` for
 * one row, `groupBookingResponse`'s `{status}` body for every member of a visit.
 *
 * Throws raw: `BookingConflictError` and the service's own `Error`s reach the
 * caller, which maps them with `statusFailureResponse` (the per-row 409/400
 * shape). An empty `cancelled` is returned, not thrown — the 404 belongs to the
 * caller, which must raise it OUTSIDE its own try/catch (an HttpError is not an
 * Error, so a catch would re-raise it as a message-less 400).
 */
export async function applyBookingStatus(
  ctx: CoreCtx,
  locals: Locals,
  id: string,
  input: z.infer<typeof patchSchema>,
): Promise<ApplyBookingStatusResult> {
  const { scope, reason, ...fields } = input;
  const opts = {
    reason: reason ?? null,
    actor: {
      id: ctx.profileId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
    },
  };
  // A cancel is the one status that can reach beyond this row (scope
  // 'following' takes the rest of the series, each returning its package
  // session), so it goes through `cancelBooking`; every other field — including
  // a non-cancel status — is the general editor's single patch.
  let cancelled: string[] = [];
  let booking: Awaited<ReturnType<typeof patchBooking>> | null = null;
  if (fields.status === 'cancelled') {
    cancelled = await cancelBooking(ctx, id, { ...opts, scope: scope ?? 'one' });
    booking = await getBooking(ctx, id);
  }
  const rest = fields.status === 'cancelled' ? { ...fields, status: undefined } : fields;
  if (Object.values(rest).some((v) => v !== undefined))
    booking = await patchBooking(ctx, id, { ...rest, ...opts });

  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: StockWarning = null;
  // TODO(handoff): Persist realization admission with the status change; this
  // postcommit attempt is still vulnerable to process loss, see meta
  // proposals/2026-09-12-hub-booking-stock-postcommit-recovery.md.
  if (fields.status === 'completed') {
    try {
      const r = await realizeAccruals(ctx, {
        source: 'booking',
        sourceId: id,
        finProductId: booking?.productId ?? null,
        partyId: booking?.partyId ?? null,
        note: booking ? `Booking: ${booking.title}` : null,
        actor: {
          id: ctx.profileId ?? null,
          name: locals.user?.displayName ?? locals.user?.email ?? null,
        },
      });
      stockWarning = r.stockWarning;
    } catch (e) {
      stockWarning = {
        code: 'realize_failed',
        message: e instanceof Error ? e.message : 'stock realize failed',
      };
    }
  }
  return { booking, cancelled, stockWarning };
}

/**
 * How a failed status change answers. `message` stays for any other
 * client/toast; `conflicts` is the structured list the calendar names in its
 * conflict dialog ("Overlaps with …") before offering "Move anyway" / "Pick
 * another time" / "Merge". `prefix` names the member on a visit-wide change
 * (empty on the per-row path, which keeps its exact legacy body).
 */
function statusFailureResponse(e: unknown, prefix = '', extra?: Record<string, unknown>): Response {
  if (e instanceof BookingConflictError)
    return json(
      { error: 'conflict', message: prefix + e.message, conflicts: e.conflicts, ...extra },
      { status: 409 },
    );
  throw error(400, prefix + (e instanceof Error ? e.message : 'invalid'));
}

export async function patchBookingResponse(
  ctx: CoreCtx,
  locals: Locals,
  request: Request,
  id: string,
): Promise<Response> {
  const b = await parseBody(request, patchSchema);
  let r: ApplyBookingStatusResult;
  try {
    r = await applyBookingStatus(ctx, locals, id, b);
  } catch (e) {
    return statusFailureResponse(e);
  }
  // An empty cancel list means the id matched nothing — 404 raised OUTSIDE the
  // try so it isn't swallowed and re-raised as a 400.
  if (b.status === 'cancelled' && !r.cancelled.length) throw error(404, 'booking not found');
  return json({
    ok: true,
    cancelled: r.cancelled,
    stockWarning: r.stockWarning,
    booking: r.booking
      ? {
          id: r.booking.id,
          start: r.booking.startTime.toISOString(),
          end: r.booking.endTime.toISOString(),
          resourceId: r.booking.resourceId,
          status: r.booking.status,
        }
      : null,
  });
}

/**
 * `POST /api/{pos/appointments,scheduling/bookings}/[id]/group` body — merged
 * visits shared by the POS calendar and `/scheduling/calendar` (kit
 * `booking-mover.ts` routes here for `mergeWith`/`detach`/`group` moves):
 *
 *   { withId }              merge this booking into the visit `withId` belongs to
 *   { detach: true }        take this booking out of its visit (restoring its
 *                           pre-merge duration; 2 members destroy the container)
 *   { move: {start,end,resourceId?} }  drag/resize the WHOLE visit this booking
 *                           belongs to — one call, one conflict check, so the box
 *                           never expands-then-contracts between PATCHes
 *   { reorder: [ids] }      restamp `groupSeq` to this order (the fan deck's
 *                           drag-to-reorder) — pure stamps, times untouched
 *   { addEventTypeId }      add a service to the EVENT this booking belongs to
 *                           (an ungrouped booking becomes seq 0 of a new visit);
 *                           the window grows by the service's own length
 *   { removeService: true } remove THIS service from its event — a hard delete
 *                           of the row, refused with 409 `referenced` when a
 *                           ticket/order/realized accrual points at it
 *   { status, reason? }     move the WHOLE event's services to one status — what
 *                           the detail tray's footer buttons do, so "Mark
 *                           completed" on a 4-service event completes (and
 *                           realizes the stock of) all four, not just the row
 *                           the tray was opened on
 *
 * All seven are edit work, so all seven are ONE POST verb: a DELETE would be
 * classified `<module>:delete` by the central write guard, and separating a
 * booking deletes nothing. `removeService` DOES delete a row — but it is the
 * drawer editing the composition of one event, not the operator deleting an
 * appointment (that is `DELETE /[id]`), and the POS twin gates it on `pos:edit`
 * for exactly that reason.
 */
const groupBodySchema = z.union([
  z.object({ withId: z.string().min(1).max(200), overrideConflicts: z.boolean().optional() }),
  z.object({ detach: z.literal(true), overrideConflicts: z.boolean().optional() }),
  z.object({
    move: z.object({
      start: z.coerce.date(),
      end: z.coerce.date(),
      resourceId: z.string().max(200).optional(),
    }),
    overrideConflicts: z.boolean().optional(),
  }),
  // Fan-deck drag-to-reorder (owner ask 2026-09-29): every member id of the
  // visit, in the new order — `reorderVisit` rejects anything short of an
  // exact match against the visit's own member set.
  z.object({ reorder: z.array(z.string().min(1).max(200)).min(1).max(MAX_GROUP_MEMBERS) }),
  // Owner ask 2026-10-07: an event can contain one or more services, edited from
  // the event itself — these two are the add/remove half of that.
  z.object({
    addEventTypeId: z.string().min(1).max(200),
    overrideConflicts: z.boolean().optional(),
  }),
  z.object({ removeService: z.literal(true) }),
  // Visit-wide status (owner ask 2026-10-08). `strictObject` so a `scope` —
  // meaningful only for a SERIES cancel, and unsupported here — is a 400 rather
  // than a silently stripped key: a visit is one occurrence.
  z.strictObject({
    status: z.enum(['accepted', 'completed', 'no_show', 'rejected', 'cancelled']),
    reason: z.string().max(500).optional(),
  }),
]);

/** Which members a visit-wide target status may touch: `accepted` only confirms
 *  what is still `pending`; every terminal target takes whatever is still live.
 *  Already-terminal members (completed/cancelled/rejected/no_show) are never
 *  re-stamped — they come back as `skipped`. */
function eligibleForVisitStatus(target: string, current: string): boolean {
  return target === 'accepted'
    ? current === 'pending'
    : (ACTIVE_STATUSES as readonly string[]).includes(current);
}

export async function groupBookingResponse(
  ctx: CoreCtx,
  locals: Locals,
  request: Request,
  id: string,
): Promise<Response> {
  const body = await parseBody(request, groupBodySchema);
  if ('status' in body) return visitStatusResponse(ctx, locals, id, body);
  // Resolved OUTSIDE the try: a `throw error(400)` from inside it would be
  // re-thrown by the catch as a message-less 400 (an HttpError is not an Error).
  // TODO(handoff): this read and `moveGroup` are two transactions, so a visit
  // separated by another user in between moves a group that no longer contains
  // this booking (it moves nothing — `moveGroup` finds no members and 400s).
  // Fold the lookup into `moveGroup` (accept a booking id and resolve the group
  // inside its own locked transaction) if that race ever shows up in practice.
  const moveGroupId = 'move' in body || 'reorder' in body ? await bookingGroupId(ctx, id) : null;
  if (('move' in body || 'reorder' in body) && !moveGroupId)
    throw error(400, 'booking is not part of a merged visit');
  try {
    if ('detach' in body) {
      const { destroyed } = await ungroupBooking(ctx, id, {
        overrideConflicts: body.overrideConflicts,
      });
      return json({ ok: true, groupId: null, destroyed });
    }
    if ('move' in body) {
      const { moved } = await moveGroup(ctx, moveGroupId!, {
        ...body.move,
        overrideConflicts: body.overrideConflicts,
      });
      return json({ ok: true, groupId: moveGroupId, moved });
    }
    if ('reorder' in body) {
      const { reordered } = await reorderVisit(ctx, moveGroupId!, body.reorder);
      return json({ ok: true, groupId: moveGroupId, reordered });
    }
    if ('addEventTypeId' in body) {
      const added = await addServiceToVisit(ctx, id, body.addEventTypeId, {
        overrideConflicts: body.overrideConflicts,
      });
      return json({ ok: true, ...added });
    }
    if ('removeService' in body) {
      const removed = await removeServiceFromVisit(ctx, id);
      return json({ ok: true, ...removed });
    }
    const { groupId } = await groupBookingWith(ctx, id, body.withId, {
      overrideConflicts: body.overrideConflicts,
    });
    return json({ ok: true, groupId });
  } catch (e) {
    if (e instanceof BookingConflictError) {
      // A merge grows the container window, a move relocates it and a separate
      // restores a member past its end: each can land on a THIRD booking, and the
      // calendar shows it in the same dialog a plain move's 409 opens.
      return json(
        { error: 'conflict', message: e.message, conflicts: e.conflicts },
        { status: 409 },
      );
    }
    // Same shape as `DELETE /[id]`'s refusal, plus `message`: the drawer offers
    // "cancel instead" and names what still points at the service.
    if (e instanceof BookingReferencedError) {
      return json(
        { error: 'referenced', references: e.references, message: e.message },
        { status: 409 },
      );
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
}

/**
 * `{ status }` — one status for every service of one event.
 *
 * Deliberately N sequential per-row `applyBookingStatus` calls, NOT one
 * transaction: each row's status change carries its own side effects (the
 * `sched_booking_status_log` row, a `completed`'s accrual realization, a
 * cancel's package-session return), and those live in the per-row path. A
 * partial application is therefore REPORTED (`applied` / `skipped` next to the
 * failure's own 409/400), never rolled back — the operator sees exactly which
 * services moved and retries the rest, which is the honest answer for work that
 * has already touched stock and package balances.
 *
 * TODO(handoff): an all-or-nothing variant needs `setBookingStatus`,
 * `realizeAccruals` and the package reversal made transactional (one `tx`
 * threaded through all three) before it can be offered; until then the tray
 * must not promise atomicity.
 */
async function visitStatusResponse(
  ctx: CoreCtx,
  locals: Locals,
  id: string,
  body: {
    status: 'accepted' | 'completed' | 'no_show' | 'rejected' | 'cancelled';
    reason?: string;
  },
): Promise<Response> {
  // An ungrouped booking (or an id this org does not have) has no members: the
  // tray calls this verb uniformly, so it falls through to the single row and
  // the per-row answers — 404 included.
  const { groupId, members } = await visitMembers(ctx, id);
  const targets = groupId
    ? members.filter((m) => eligibleForVisitStatus(body.status, m.status))
    : [{ id, status: '' }];
  const skipped = groupId
    ? members.filter((m) => !eligibleForVisitStatus(body.status, m.status)).map((m) => m.id)
    : [];

  const applied: string[] = [];
  const warnings: NonNullable<StockWarning>[] = [];
  for (const m of targets) {
    let r: ApplyBookingStatusResult;
    try {
      r = await applyBookingStatus(ctx, locals, m.id, {
        status: body.status,
        reason: body.reason ?? null,
      });
    } catch (e) {
      // Stop at the first failure: the rest of the visit is untouched, and
      // `applied` says what already moved.
      return statusFailureResponse(e, `${m.id}: `, { groupId, applied, skipped });
    }
    // Raised OUTSIDE the try for the same reason as the per-row path's 404.
    if (body.status === 'cancelled' && !r.cancelled.length)
      throw error(404, `booking not found: ${m.id}`);
    applied.push(m.id);
    if (r.stockWarning) warnings.push(r.stockWarning);
  }
  return json({
    ok: true,
    groupId,
    applied,
    skipped,
    stockWarning: warnings[0] ?? null,
    warnings: warnings.slice(1),
  });
}
