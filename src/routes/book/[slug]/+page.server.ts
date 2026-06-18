import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolvePublicLink } from '$server/services/scheduling-public.service';

/** Public, unauthenticated booking page. Resolves the org from the link slug. */
export const load: PageServerLoad = async ({ params }) => {
  const resolved = await resolvePublicLink(params.slug);
  if (!resolved) throw error(404, 'Scheduling link not found');
  return {
    slug: resolved.link.slug,
    title: resolved.link.title,
    description: resolved.link.description,
    eventTypes: resolved.eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      length: e.length,
    })),
  };
};
