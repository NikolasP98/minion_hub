import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listPendingRequests } from '$server/services/join/requests.service';
import { listLinks } from '$server/services/join/links.service';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  const orgs = await getDb().select({ id: organization.id, name: organization.name }).from(organization);
  return {
    requests: await listPendingRequests(),
    links: await listLinks(),
    orgs,
  };
};
