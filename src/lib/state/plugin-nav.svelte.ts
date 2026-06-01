import type { PluginUiManifestOccupant } from "$lib/plugins/plugin-types";

export const pluginNavState = $state<{
  controlCenters: PluginUiManifestOccupant[];
  /**
   * Plugins that expose a `settings.plugins` UI. Keyed by pluginId for fast
   * lookup from places like the channels tab, which embeds the settings UI
   * inline for the matching channel type (pluginId == channelType for first-
   * party comms plugins like whatsapp, telegram, discord).
   */
  settingsByPluginId: Record<string, PluginUiManifestOccupant>;
  /**
   * Whether each plugin is enabled, keyed by pluginId. Absent configEnabled
   * on an entry is treated as true (back-compat). Used by gateSections() to
   * conditionally show/hide plugin-contributed nav items (e.g. /flow-editor).
   */
  enabledByPluginId: Record<string, boolean>;
  loaded: boolean;
  error: string | null;
}>({ controlCenters: [], settingsByPluginId: {}, enabledByPluginId: {}, loaded: false, error: null });

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
    const enabled: Record<string, boolean> = {};
    for (const e of entries) enabled[e.pluginId] = e.configEnabled !== false;
    pluginNavState.enabledByPluginId = enabled;
    pluginNavState.loaded = true;
  } catch (err) {
    pluginNavState.error = err instanceof Error ? err.message : String(err);
    pluginNavState.loaded = true;
  }
}
