import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import {
  createBooking,
  patchBooking,
  cancelBooking,
  getBooking,
  getBookingDetail,
  SlotUnavailableError,
  BookingConflictError,
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
    const booking = await createBooking(ctx, {
      eventTypeId: b.eventTypeId,
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
      source: 'internal',
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
    });
    return json({ booking });
  } catch (e) {
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

export async function patchBookingResponse(
  ctx: CoreCtx,
  locals: Locals,
  request: Request,
  id: string,
): Promise<Response> {
  const b = await parseBody(request, patchSchema);
  const { scope, reason, ...fields } = b;
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
  try {
    if (fields.status === 'cancelled') {
      cancelled = await cancelBooking(ctx, id, { ...opts, scope: scope ?? 'one' });
      booking = await getBooking(ctx, id);
    }
    const rest = fields.status === 'cancelled' ? { ...fields, status: undefined } : fields;
    if (Object.values(rest).some((v) => v !== undefined))
      booking = await patchBooking(ctx, id, { ...rest, ...opts });
  } catch (e) {
    if (e instanceof BookingConflictError) {
      // `message` stays for any other client/toast; `conflicts` is the structured
      // list the calendar names in its conflict dialog ("Overlaps with …") before
      // offering "Move anyway" / "Pick another time" / "Merge".
      return json(
        { error: 'conflict', message: e.message, conflicts: e.conflicts },
        { status: 409 },
      );
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  // An empty cancel list means the id matched nothing — 404 raised OUTSIDE the
  // try so it isn't swallowed and re-raised as a 400.
  if (b.status === 'cancelled' && !cancelled.length) throw error(404, 'booking not found');
  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: { code: string; message: string; draftEntryId?: string } | null = null;
  // TODO(handoff): Persist realization admission with the status change; this
  // postcommit attempt is still vulnerable to process loss, see meta
  // proposals/2026-09-12-hub-booking-stock-postcommit-recovery.md.
  if (b.status === 'completed') {
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
  return json({
    ok: true,
    cancelled,
    stockWarning,
    booking: booking
      ? {
          id: booking.id,
          start: booking.startTime.toISOString(),
          end: booking.endTime.toISOString(),
          resourceId: booking.resourceId,
          status: booking.status,
        }
      : null,
  });
}
