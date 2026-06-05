import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';

/**
 * The join-requests list and join-links list are loaded via remote queries
 * (`$lib/remote/join.remote`) so admin mutations can single-flight-refresh them
 * without a full `invalidateAll()`. This load only gates access + supplies the
 * org list for the mint-link form (rarely changes).
 */
export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  const orgs = await getDb()
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  return { orgs };
};
