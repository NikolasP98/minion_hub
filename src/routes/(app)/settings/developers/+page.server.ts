import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listConnections } from '$server/mcp/oauth.service';
import { listKeys } from '$server/services/org-api-keys.service';

/** Settings → Developers (spec 121, 143): the organization's API keys and connected apps. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  depends('settings:developers');
  return {
    keys: await listKeys(ctx),
    // The page itself needs settings:manage, so every connection of the organization is listed.
    connections: await listConnections(ctx.tenantId, locals.user!.supabaseId!, true),
  };
};
