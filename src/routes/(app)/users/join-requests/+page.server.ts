import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listPendingRequests } from '$server/services/join/requests.service';
import { listLinks } from '$server/services/join/links.service';
import { listAllOrganizations } from '$server/services/organizations.service';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  // Supabase organizations (Turso fallback during bake).
  const orgs = await listAllOrganizations();
  return {
    requests: await listPendingRequests(),
    links: await listLinks(),
    orgs,
  };
};
