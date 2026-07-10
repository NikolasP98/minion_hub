import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { listServers } from '$server/services/server.service';
import type { TenantContext } from '$server/services/base';

export const load: PageServerLoad = async ({ locals }) => {
  // Gateway plumbing is platform-admin-only: which instance serves a user is
  // decided by org assignment / the balancer, never by the user. 404 (not
  // 403) so the page simply doesn't exist for everyone else.
  if (locals.user?.role !== 'admin') throw error(404, 'Not found');

  const [pgGateways, tursoHosts] = await Promise.all([
    listGatewaysForAdmin(),
    locals.tenantCtx
      ? listServers(locals.tenantCtx as TenantContext, locals.user?.id, locals.user?.role)
      : Promise.resolve([]),
  ]);

  return { pgGateways, tursoHosts };
};
