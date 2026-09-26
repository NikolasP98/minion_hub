import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { parseBody } from '$server/api/validate';
import {
  groupBookingWith,
  ungroupBooking,
  moveGroup,
  bookingGroupId,
  BookingConflictError,
} from '$server/services/scheduling-bookings.service';

/**
 * POST /api/pos/appointments/[id]/group — merged visits for the POS calendar
 * (owner ask 2026-09-25: dragging an event onto another one for the same client
 * and team member joins them into a single block; a settings action separates
 * them again).
 *
 *   { withId }              merge this booking into the visit `withId` belongs to
 *   { detach: true }        take this booking out of its visit (restoring its
 *                           pre-merge duration; 2 members destroy the container)
 *   { move: {start,end,resourceId?} }  drag/resize the WHOLE visit this booking
 *                           belongs to — one call, one conflict check, so the box
 *                           never expands-then-contracts between PATCHes
 *
 * All three are `edit` work, so all three are ONE POST verb: a DELETE would be classified
 * `pos:delete` by the central write guard (`apiWriteCapability`), and separating
 * an appointment deletes nothing.
 *
 * TODO(handoff): no `/api/scheduling/bookings/[id]/group` twin. Merged visits are
 * a `BookingCalendar` feature and that renderer is POS-only today
 * (`/scheduling/calendar` runs on `@event-calendar/core`), so the scheduling
 * route would have no caller. The service functions are surface-agnostic — add
 * the twin route with the `scheduling:edit` gate when that calendar adopts the
 * feature. See proposals/2026-09-16-calendar-implementation-split.md.
 */
const bodySchema = z.union([
  z.object({ withId: z.string().min(1).max(200) }),
  z.object({ detach: z.literal(true), overrideConflicts: z.boolean().optional() }),
  z.object({
    move: z.object({
      start: z.coerce.date(),
      end: z.coerce.date(),
      resourceId: z.string().max(200).optional(),
    }),
    overrideConflicts: z.boolean().optional(),
  }),
]);

export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  await requireOrgCapability(locals, 'pos', 'edit');

  const body = await parseBody(request, bodySchema);
  // Resolved OUTSIDE the try: a `throw error(400)` from inside it would be
  // re-thrown by the catch as a message-less 400 (an HttpError is not an Error).
  // TODO(handoff): this read and `moveGroup` are two transactions, so a visit
  // separated by another user in between moves a group that no longer contains
  // this booking (it moves nothing — `moveGroup` finds no members and 400s).
  // Fold the lookup into `moveGroup` (accept a booking id and resolve the group
  // inside its own locked transaction) if that race ever shows up in practice.
  // TODO(handoff): no route-level test for this body union — the `/group` route
  // has never had one (there is no handler-test pattern for it here); the three
  // shapes are covered at the service layer in
  // src/server/services/scheduling-bookings-group.test.ts.
  const moveGroupId = 'move' in body ? await bookingGroupId(ctx, params.id!) : null;
  if ('move' in body && !moveGroupId) throw error(400, 'booking is not part of a merged visit');
  try {
    if ('detach' in body) {
      const { destroyed } = await ungroupBooking(ctx, params.id!, {
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
    const { groupId } = await groupBookingWith(ctx, params.id!, body.withId);
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
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
};
