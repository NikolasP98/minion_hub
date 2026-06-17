import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

// Data Hygiene moved into CRM Settings as the "Hygiene" tab. Keep this legacy
// route as a permanent redirect so any bookmarks / external links still land
// on the right place.
export const load: PageServerLoad = () => {
  throw redirect(308, '/crm/settings?tab=hygiene');
};
