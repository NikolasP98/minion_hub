import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { groupBookingResponse } from '../../_handlers';

/**
 * POST /api/scheduling/bookings/[id]/group — the `scheduling:edit` twin of
 * `/api/pos/appointments/[id]/group`, for `BookingCalendar` running on
 * `/scheduling/calendar` (kit `booking-mover.ts` picks the route by `apiBase`).
 * Body shapes + the merge/detach/move dispatch are shared via
 * `groupBookingResponse` in `../../_handlers`. Capability gate is central
 * (`/api/scheduling` → `scheduling:edit`, see hooks.server.ts
 * `apiWriteCapability` + `API_WRITE_PREFIXES`) — same pattern as the sibling
 * `PATCH`/`DELETE` on `[id]/+server.ts`.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return groupBookingResponse(ctx, request, params.id!);
};
