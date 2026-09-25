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
  BookingConflictError,
} from '$server/services/scheduling-bookings.service';

/**
 * POST /api/pos/appointments/[id]/group — merged visits for the POS calendar
 * (owner ask 2026-09-25: dragging an event onto another one for the same client
 * and team member joins them into a single block; a settings action separates
 * them again).
 *
 *   { withId }        merge this booking into the visit `withId` belongs to
 *   { detach: true }  take this booking out of its visit, keeping its time
 *
 * Both are `edit` work, so both are ONE POST verb: a DELETE would be classified
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
  z.object({ detach: z.literal(true) }),
]);

export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  await requireOrgCapability(locals, 'pos', 'edit');

  const body = await parseBody(request, bodySchema);
  try {
    if ('detach' in body) {
      await ungroupBooking(ctx, params.id!);
      return json({ ok: true, groupId: null });
    }
    const { groupId } = await groupBookingWith(ctx, params.id!, body.withId);
    return json({ ok: true, groupId });
  } catch (e) {
    if (e instanceof BookingConflictError) {
      // The merge re-times the dragged booking to the visit's end; a clash there
      // is with a THIRD booking, and the calendar shows it in the same dialog a
      // plain move's 409 opens.
      return json(
        { error: 'conflict', message: e.message, conflicts: e.conflicts },
        { status: 409 },
      );
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
};
