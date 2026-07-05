import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// /ads/* moved to /socials/* (2026-07-05 rename). Bookmarks and any
// in-flight Meta OAuth redirect mid-transition should still land correctly.
export const load: PageServerLoad = async ({ params, url }) => {
  throw redirect(301, `/socials/${params.path}${url.search}`);
};
