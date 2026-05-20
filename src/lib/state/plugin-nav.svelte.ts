import type { PluginUiManifestOccupant } from "$lib/plugins/PluginSlotHost.svelte";

export const pluginNavState = $state<{
  controlCenters: PluginUiManifestOccupant[];
  /**
   * Plugins that expose a `settings.plugins` UI. Keyed by pluginId for fast
   * lookup from places like the channels tab, which embeds the settings UI
   * inline for the matching channel type (pluginId == channelType for first-
   * party comms plugins like whatsapp, telegram, discord).
   */
  settingsByPluginId: Record<string, PluginUiManifestOccupant>;
  loaded: boolean;
  error: string | null;
}>({ controlCenters: [], settingsByPluginId: {}, loaded: false, error: null });

export async function hydratePluginNav(): Promise<void> {
  if (pluginNavState.loaded) return;
  try {
    const res = await fetch("/api/plugins/ui-list", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { entries } = (await res.json()) as { entries: PluginUiManifestOccupant[] };
    pluginNavState.controlCenters = entries.filter(
      (e) => e.slot === "plugins.controlCenter",
    );
    const byId: Record<string, PluginUiManifestOccupant> = {};
    for (const entry of entries) {
      if (entry.slot === "settings.plugins") {
        byId[entry.pluginId] = entry;
      }
    }
    pluginNavState.settingsByPluginId = byId;
    pluginNavState.loaded = true;
  } catch (err) {
    pluginNavState.error = err instanceof Error ? err.message : String(err);
    pluginNavState.loaded = true;
  }
}
