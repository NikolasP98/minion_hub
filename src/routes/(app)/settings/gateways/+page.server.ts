import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { listServers } from '$server/services/server.service';
import type { TenantContext } from '$server/services/base';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');

  const [pgGateways, tursoHosts] = await Promise.all([
    listGatewaysForAdmin(),
    locals.tenantCtx
      ? listServers(locals.tenantCtx as TenantContext, locals.user?.id, locals.user?.role)
      : Promise.resolve([]),
  ]);

  return { pgGateways, tursoHosts };
};
