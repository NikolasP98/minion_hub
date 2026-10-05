import { json, error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getSlotsForEventType } from '$server/services/scheduling-slots.service';
import { MAX_GROUP_MEMBERS } from '$server/services/scheduling-bookings.service';

/** Shared bounded staff lookup. Each route establishes its domain authority first. */
export async function staffSlotsResponse(ctx: CoreCtx, url: URL): Promise<Response> {
  const eventTypeId = url.searchParams.get('eventTypeId');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!eventTypeId || !fromStr || !toStr) throw error(400, 'eventTypeId, from, to required');
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw error(400, 'invalid date');
  if (to <= from || to.getTime() - from.getTime() > 62 * 86_400_000)
    throw error(400, 'range must be positive and at most 62 days');
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
}
