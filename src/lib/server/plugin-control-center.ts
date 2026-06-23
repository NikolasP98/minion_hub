import { error } from '@sveltejs/kit';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';

/**
 * Resolve a plugin control-center entry by pluginId, applying the per-org gate.
 * Shared by the generic `/plugins/[id]` route and the channels `/channels/[id]`
 * route so the 404 / org-disabled rules stay in one place.
 */
export async function loadPluginControlCenter(
  id: string,
  locals: App.Locals,
  origin: string,
) {
  const orgId = locals?.orgId ?? locals?.tenantCtx?.tenantId;
  const [all, gatewayBaseUrl] = await Promise.all([
    pluginsUiList(locals?.user?.supabaseId, orgId),
    getGatewayHttpUrl(),
  ]);
  const entry = all.find((e) => e.slot === 'plugins.controlCenter' && e.pluginId === id);
  if (!entry) {
    error(404, `Plugin control center not found: ${id}`);
  }
  if (entry.orgEnabled === false) {
    error(404, `Plugin not available for this organization: ${id}`);
  }
  return { entry, gatewayBaseUrl, hubOrigin: origin };
}
