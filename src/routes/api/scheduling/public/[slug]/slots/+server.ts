import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { publicSlots } from '$server/services/scheduling-public.service';

/** Public, unauthenticated slot lookup behind a scheduling-link slug. */
export const GET: RequestHandler = async ({ params, url }) => {
  const eventTypeId = url.searchParams.get('eventTypeId');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!eventTypeId || !fromStr || !toStr) throw error(400, 'eventTypeId, from, to required');
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw error(400, 'invalid date');
  // Cap the lookup window to 60 days to bound work on a public endpoint.
  if (to.getTime() - from.getTime() > 62 * 86_400_000) throw error(400, 'range too wide');
  const slots = await publicSlots(params.slug!, eventTypeId, from, to);
  if (slots === null) throw error(404, 'link or service not found');
  return json({ slots });
};
