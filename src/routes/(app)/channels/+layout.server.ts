import type { LayoutServerLoad } from './$types';
import { pluginsUiList } from '$lib/server/gateway-rpc';
import { isChannelPlugin } from '$lib/components/layout/sections';

export type ChannelEntry = {
  pluginId: string;
  title: string;
  description: string;
  icon?: string;
  status?: string;
};

// Enabled channel plugins for the acting org, resolved server-side so both the
// side-menu and the overview render without a hydration flash.
export const load: LayoutServerLoad = async ({ locals }) => {
  const orgId = locals?.orgId ?? locals?.tenantCtx?.tenantId;
  const all = await pluginsUiList(locals?.user?.supabaseId, orgId);
  const channels: ChannelEntry[] = all
    .filter((e) => e.slot === 'plugins.controlCenter' && e.orgEnabled !== false && isChannelPlugin(e))
    .map((e) => ({
      pluginId: e.pluginId,
      title: e.title,
      description: e.description,
      icon: e.icon,
      status: e.status,
    }));
  return { channels };
};
