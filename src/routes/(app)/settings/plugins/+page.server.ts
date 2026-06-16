import type { PageServerLoad } from './$types';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';
import type { PluginUiManifestOccupant } from '$lib/plugins/plugin-types';

export type PluginManifestErrorKind = 'originNotAllowed' | 'unreachable' | 'other';

function classifyError(message: string): PluginManifestErrorKind {
  if (/origin not allowed/i.test(message)) return 'originNotAllowed';
  if (/ECONN|fetch failed|timeout|gateway .* unreachable/i.test(message)) return 'unreachable';
  return 'other';
}

export const load: PageServerLoad = async ({ url, locals }) => {
  let entries: PluginUiManifestOccupant[] = [];
  let gatewayBaseUrl = '';
  let errorMessage: string | undefined;
  let errorKind: PluginManifestErrorKind | undefined;
  // Per-org enable/disable: the gateway computes each entry's `orgEnabled`
  // against the acting user's org. The hub→gateway connection uses an admin
  // token with no org claim, so pass the org explicitly.
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? undefined;
  try {
    const [all, baseUrl] = await Promise.all([pluginsUiList(undefined, orgId), getGatewayHttpUrl()]);
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
