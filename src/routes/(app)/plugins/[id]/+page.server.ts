import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  // Pass the acting org so the entry carries per-org `orgEnabled`.
  const orgId = locals?.orgId ?? locals?.tenantCtx?.tenantId;
  const [all, gatewayBaseUrl] = await Promise.all([
    pluginsUiList(locals?.user?.supabaseId, orgId),
    getGatewayHttpUrl(),
  ]);
  const entry = all.find(
    (e) => e.slot === 'plugins.controlCenter' && e.pluginId === params.id,
  );
  if (!entry) {
    error(404, `Plugin control center not found: ${params.id}`);
  }
  // Per-org gate: a plugin disabled for this org is not navigable — its control
  // center 404s even by direct URL (the sidebar link is hidden in tandem).
  if (entry.orgEnabled === false) {
    error(404, `Plugin not available for this organization: ${params.id}`);
  }
  return { entry, gatewayBaseUrl, hubOrigin: url.origin };
};
