import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listAllOrganizationsWithMemberCounts } from '$server/services/organizations.service';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('orgs.all', locals.user)) throw error(403, 'Admin access required');
  // Supabase organizations + organization_members (Turso fallback during bake).
  const orgs = await listAllOrganizationsWithMemberCounts();
  return { orgs };
};
