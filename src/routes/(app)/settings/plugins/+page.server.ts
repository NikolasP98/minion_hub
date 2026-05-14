import type { PageServerLoad } from './$types';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';
import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

export type PluginManifestErrorKind = 'originNotAllowed' | 'unreachable' | 'other';

function classifyError(message: string): PluginManifestErrorKind {
  if (/origin not allowed/i.test(message)) return 'originNotAllowed';
  if (/ECONN|fetch failed|timeout|gateway .* unreachable/i.test(message)) return 'unreachable';
  return 'other';
}

export const load: PageServerLoad = async ({ url }) => {
  let entries: PluginUiManifestOccupant[] = [];
  let gatewayBaseUrl = '';
  let errorMessage: string | undefined;
  let errorKind: PluginManifestErrorKind | undefined;
  try {
    const [all, baseUrl] = await Promise.all([pluginsUiList(), getGatewayHttpUrl()]);
    entries = all.filter((entry) => entry.slot === 'settings.plugins');
    gatewayBaseUrl = baseUrl;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    errorKind = classifyError(errorMessage);
    console.warn('[settings/plugins] failed to load plugin UI manifest:', errorMessage);
  }

  return {
    entries,
    gatewayBaseUrl,
    error: errorMessage,
    errorKind,
    hubOrigin: url.origin,
  };
};
