import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  return { gateways: await listGatewaysForAdmin() };
};
