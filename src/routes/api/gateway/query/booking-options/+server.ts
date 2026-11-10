import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { assistantBookingOptions } from '$server/services/assistant-booking-options.service';

/**
 * GET /api/gateway/query/booking-options?agentId=personal-<uuid>[&orgId=]
 *     [&query=][&eventTypeId=][&resourceId=][&date=YYYY-MM-DD][&limit=]
 * Requires the assigned principal's scheduling:view capability. limit is 1..100
 * (default 50); query matches event titles. Only active scoped event types and
 * their eligible active resources are returned, without resource contact PII.
 * date requires eventTypeId and selects one real calendar day in the Finance
 * timezone; resource timezone is also returned for display. Optional resourceId
 * pins the lookup. Slots reference only returned resources, so coverage reports
 * caps separately for eventTypes, resources and those eligible slots.
 * Availability is at-read only: creation/reschedule must revalidate the slot.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { ctx } = await requireAssistantCapability(locals, url, 'scheduling', 'view');
  return json(
    await assistantBookingOptions(ctx, {
      query: url.searchParams.get('query') ?? undefined,
      eventTypeId: url.searchParams.get('eventTypeId') ?? undefined,
      resourceId: url.searchParams.get('resourceId') ?? undefined,
      date: url.searchParams.get('date') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 50),
    }),
  );
};
