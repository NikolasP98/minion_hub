import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { pluginsUiList, getGatewayHttpUrl } from '$lib/server/gateway-rpc';

export const load: PageServerLoad = async ({ params, url }) => {
  const [all, gatewayBaseUrl] = await Promise.all([pluginsUiList(), getGatewayHttpUrl()]);
  const entry = all.find(
    (e) => e.slot === 'plugins.controlCenter' && e.pluginId === params.id,
  );
  if (!entry) {
    error(404, `Plugin control center not found: ${params.id}`);
  }
  return { entry, gatewayBaseUrl, hubOrigin: url.origin };
};
