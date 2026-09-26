import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getSlotsForEventType } from '$server/services/scheduling-slots.service';
import { MAX_GROUP_MEMBERS } from '$server/services/scheduling-bookings.service';

/** Internal (authed) slot lookup for the staff booking UI. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const eventTypeId = url.searchParams.get('eventTypeId');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!eventTypeId || !fromStr || !toStr) throw error(400, 'eventTypeId, from, to required');
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw error(400, 'invalid date');
  // `withEventTypeIds=b,c` — the further procedures of one container visit, so
  // the grid offers slots long enough for the whole visit on a resource assigned
  // to every one of them (see createBookingGroup).
  const withEventTypeIds = (url.searchParams.get('withEventTypeIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (withEventTypeIds.length >= MAX_GROUP_MEMBERS) throw error(400, 'too many procedures');
  const result = await getSlotsForEventType(ctx, eventTypeId, from, to, { withEventTypeIds });
  if (!result) throw error(404, 'event type not found');
  return json({
    resourceIds: result.resourceIds,
    slots: result.slots.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      resourceIds: s.resourceIds,
    })),
  });
};
