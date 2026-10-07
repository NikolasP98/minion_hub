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
} from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';
import { CustomPropertyError } from '$server/services/custom-properties.service';
import { requireCustomPropertyAccess } from '$server/services/custom-properties-access';
import { authorizeCustomPropertyRecords } from '$server/services/custom-property-entities.service';
import type { BookingPropertyWrite } from '$server/services/scheduling-bookings.service';
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

/** The custom-property table a booking classifies on (its calendar subcolumns). */
const BOOKINGS_TABLE = 'scheduling.bookings';
/** Cap on writes per command: one select column × the members of one visit. */
const PROPERTY_WRITES_MAX = 20;
const propertyValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
/**
 * A custom-column write riding on a move (HC-011): the same `{propertyId,
 * value, expectedVersion}` the standalone `PUT /api/tables/properties/values`
 * takes. `recordId` is required on the group shape (one entry per member) and
 * optional on a single PATCH, where it must be the patched booking.
 */
const propertyWriteSchema = z.object({
  propertyId: z.string().uuid(),
  recordId: z.string().min(1).max(200).optional(),
  value: propertyValueSchema,
  expectedVersion: z.number().int().nonnegative(),
});
const propertiesSchema = z.array(propertyWriteSchema).max(PROPERTY_WRITES_MAX).optional();

/** The property stage refused: the whole command was rolled back, nothing moved. */
const propertyRefusal = (e: CustomPropertyError) =>
  json({ error: 'property', code: e.code, message: e.code }, { status: e.status });

/**
 * Authorize the property stage BEFORE the service opens its transaction, the
 * same two checks `PUT /api/tables/properties/values` runs: the module edit
 * capability (scheduling OR pos — the POS calendar's cashier) and the
 * record-level edit right for every booking written. A refusal returns the
 * property-stage envelope; nothing has been written yet. Called outside the
 * handlers' `try` so the 403 `HttpError` from `requireCustomPropertyAccess`
 * reaches the client as itself, not as a message-less 400.
 */
async function authorizeBookingProperties(
  locals: Locals,
  ctx: CoreCtx,
  writes: BookingPropertyWrite[],
): Promise<Response | null> {
  if (!writes.length) return null;
  await requireCustomPropertyAccess(locals, ctx, BOOKINGS_TABLE, 'edit');
  const ids = [...new Set(writes.map((w) => w.recordId))];
  const access = await authorizeCustomPropertyRecords(locals, ctx, BOOKINGS_TABLE, ids, 'edit');
  if (ids.some((id) => !access[id]?.canEdit))
    return propertyRefusal(new CustomPropertyError(404, 'record_unavailable'));
  return null;
}

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
    /** Custom-column writes committed WITH the move (HC-011). */
    properties: propertiesSchema,
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
  if (b.properties?.some((p) => p.recordId !== undefined && p.recordId !== id))
    throw error(400, 'properties.recordId must be the patched booking');
  const properties: BookingPropertyWrite[] = (b.properties ?? []).map((p) => ({
    ...p,
    recordId: id,
  }));
  const refused = await authorizeBookingProperties(locals, ctx, properties);
  if (refused) return refused;
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
      booking = await patchBooking(ctx, id, { ...rest, properties, ...opts });
  } catch (e) {
    // The property stage refused inside the transaction: the reschedule rolled
    // back with it. Same codes `propertyApiError` maps, in an envelope that
    // names the stage so the client can say which part was refused.
    if (e instanceof CustomPropertyError) return propertyRefusal(e);
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
 *
 * All four are edit work, so all four are ONE POST verb: a DELETE would be
 * classified `<module>:delete` by the central write guard, and separating a
 * booking deletes nothing.
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
    /** Custom-column writes committed WITH the move, one per member (HC-011). */
    properties: z
      .array(propertyWriteSchema.required({ recordId: true }))
      .max(PROPERTY_WRITES_MAX)
      .optional(),
  }),
  // Fan-deck drag-to-reorder (owner ask 2026-09-29): every member id of the
  // visit, in the new order — `reorderVisit` rejects anything short of an
  // exact match against the visit's own member set.
  z.object({ reorder: z.array(z.string().min(1).max(200)).min(1).max(MAX_GROUP_MEMBERS) }),
]);

export async function groupBookingResponse(
  ctx: CoreCtx,
  locals: Locals,
  request: Request,
  id: string,
): Promise<Response> {
  const body = await parseBody(request, groupBodySchema);
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
  if ('move' in body && body.properties?.length) {
    const refused = await authorizeBookingProperties(locals, ctx, body.properties);
    if (refused) return refused;
  }
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
        properties: body.properties,
      });
      return json({ ok: true, groupId: moveGroupId, moved });
    }
    if ('reorder' in body) {
      const { reordered } = await reorderVisit(ctx, moveGroupId!, body.reorder);
      return json({ ok: true, groupId: moveGroupId, reordered });
    }
    const { groupId } = await groupBookingWith(ctx, id, body.withId, {
      overrideConflicts: body.overrideConflicts,
    });
    return json({ ok: true, groupId });
  } catch (e) {
    if (e instanceof CustomPropertyError) return propertyRefusal(e);
    if (e instanceof BookingConflictError) {
      // A merge grows the container window, a move relocates it and a separate
      // restores a member past its end: each can land on a THIRD booking, and the
      // calendar shows it in the same dialog a plain move's 409 opens.
      return json(
        { error: 'conflict', message: e.message, conflicts: e.conflicts },
        { status: 409 },
      );
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
}
