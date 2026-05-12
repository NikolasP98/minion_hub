import type { PageServerLoad } from './$types';
import { pluginsUiList } from '$lib/server/gateway-rpc';
import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

export const load: PageServerLoad = async () => {
  const gatewayUrl = process.env.MINION_GATEWAY_URL ?? process.env.OPENCLAW_GATEWAY_URL ?? '';
  const authToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? '';

  let entries: PluginUiManifestOccupant[] = [];
  let errorMessage: string | undefined;
  try {
    const all = await pluginsUiList();
    entries = all.filter((entry) => entry.slot === 'settings.plugins');
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[settings/plugins] failed to load plugin UI manifest:', errorMessage);
  }

  return {
    entries,
    gatewayUrl,
    authToken,
    error: errorMessage,
  };
};
