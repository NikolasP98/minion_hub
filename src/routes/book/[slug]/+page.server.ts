import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolvePublicLink } from '$server/services/scheduling-public.service';
import { bumpDoorStat, isLikelyBot } from '$server/services/doors.service';
import { parseAttribution } from '$lib/doors/attribution';

/** Public, unauthenticated booking page. Resolves the org from the link slug. */
export const load: PageServerLoad = async ({ params, url, request }) => {
  const resolved = await resolvePublicLink(params.slug);
  if (!resolved) throw error(404, 'Scheduling link not found');
  const door = `book:${resolved.link.id}` as const;
  // Anonymous counter only: no IP, no user agent stored.
  if (!isLikelyBot(request.headers.get('user-agent'))) {
    await bumpDoorStat(resolved.ctx, door, 'views');
  }
  return {
    slug: resolved.link.slug,
    title: resolved.link.title,
    description: resolved.link.description,
    attribution: parseAttribution(url, request.headers.get('referer'), url.host, door),
    eventTypes: resolved.eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      length: e.length,
    })),
  };
};
