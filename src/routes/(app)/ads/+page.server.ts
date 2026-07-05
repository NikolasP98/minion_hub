import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// /ads moved to /socials (2026-07-05 rename). Bare /ads (no subpath) isn't
// covered by the ads/[...path] catch-all below — SvelteKit routes /ads
// itself to this file, not the rest-param route.
export const load: PageServerLoad = async ({ url }) => {
  throw redirect(301, `/socials${url.search}`);
};
