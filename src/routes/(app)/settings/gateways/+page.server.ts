import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { listServers } from '$server/services/server.service';
import type { TenantContext } from '$server/services/base';

export const load: PageServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'settings', 'manage');

  const [pgGateways, tursoHosts] = await Promise.all([
    listGatewaysForAdmin(),
    locals.tenantCtx
      ? listServers(locals.tenantCtx as TenantContext, locals.user?.id, locals.user?.role)
      : Promise.resolve([]),
  ]);

  return { pgGateways, tursoHosts };
};
