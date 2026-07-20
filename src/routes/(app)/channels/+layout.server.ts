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
  // The gateway is a remote dependency: when it's down, mid-restart, or missing its
  // plugin UI assets, this RPC rejects. Letting that escape 500s the ENTIRE /channels
  // subtree (it's a layout load), hiding the hub-native Gmail card too. Degrade to
  // "no gateway plugins" instead and surface the reason to the page.
  let all: Awaited<ReturnType<typeof pluginsUiList>> = [];
  let gatewayError: string | null = null;
  try {
    all = await pluginsUiList(locals?.user?.supabaseId, orgId);
  } catch (e) {
    gatewayError = e instanceof Error ? e.message : 'Gateway unreachable';
    console.error('[channels] plugins.ui.list failed:', e);
  }
  const channels: ChannelEntry[] = all
    .filter((e) => e.slot === 'plugins.controlCenter' && e.orgEnabled !== false && isChannelPlugin(e))
    .map((e) => ({
      pluginId: e.pluginId,
      title: e.title,
      description: e.description,
      icon: e.icon,
      status: e.status,
    }));

  // Gmail is hub-native (Google identities + shared inboxes live in the hub
  // DB), not a gateway channel plugin — append its card manually. Status
  // reflects whether the signed-in user can reach any Gmail account at all.
  const supabaseId = locals?.user?.supabaseId ?? locals?.user?.id;
  let gmailConnected = false;
  if (supabaseId) {
    const [{ getGoogleCredentialFromSupabase }, { listAvailableSharedIdentities }] =
      await Promise.all([
        import('$server/services/supabase-credential'),
        import('$server/services/shared-identity.service'),
      ]);
    const [own, shared] = await Promise.all([
      getGoogleCredentialFromSupabase(supabaseId).catch(() => null),
      orgId
        ? listAvailableSharedIdentities(supabaseId, orgId).catch(() => [])
        : Promise.resolve([]),
    ]);
    gmailConnected = own !== null || shared.some((s) => s.provider === 'google');
  }
  channels.push({
    pluginId: 'gmail',
    title: 'Gmail',
    description: 'Shared inboxes, feed access, account health.',
    icon: 'gmail',
    status: gmailConnected ? 'loaded' : undefined,
  });

  return { channels, gatewayError };
};
