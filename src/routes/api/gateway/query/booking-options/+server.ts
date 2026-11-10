import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { assistantBookingOptions } from '$server/services/assistant-booking-options.service';

/** Bounded scheduling references and native local-day availability, never a reservation. */
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
