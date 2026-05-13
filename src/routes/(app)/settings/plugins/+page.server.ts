import type { PageServerLoad } from './$types';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';
import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

export const load: PageServerLoad = async () => {
  // No longer reads gateway env vars. The page used to receive a
  // plaintext `authToken` here for downstream client-side WS use; that
  // was a leak. If a plugin UI needs a gateway connection from the
  // browser, it should now fetch a token via POST /api/servers/[id]/token
  // for the user's active host.
  let entries: PluginUiManifestOccupant[] = [];
  let gatewayBaseUrl = '';
  let errorMessage: string | undefined;
  try {
    const [all, baseUrl] = await Promise.all([pluginsUiList(), getGatewayHttpUrl()]);
    entries = all.filter((entry) => entry.slot === 'settings.plugins');
    gatewayBaseUrl = baseUrl;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[settings/plugins] failed to load plugin UI manifest:', errorMessage);
  }

  return {
    entries,
    gatewayBaseUrl,
    error: errorMessage,
  };
};
