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
   * Whether each plugin is enabled FOR THE ACTING ORG, keyed by pluginId.
   * Prefers per-org `orgEnabled`, falling back to global `configEnabled`, then
   * true (back-compat / older gateway). The sidebar dims plugins that are off
   * for this org; updated optimistically by `setPluginEnabled` on toggle so the
   * nav reacts without a reload.
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
    for (const e of entries) {
      // Per-org state wins; fall back to global soft-master, then enabled.
      const on = e.orgEnabled ?? e.configEnabled ?? true;
      enabled[e.pluginId] = on !== false;
    }
    pluginNavState.enabledByPluginId = enabled;
    // Also merge native module states (finances, crm) so the Task-11 nav gate
    // sees them alongside plugin-enabled flags. A failure here must not prevent
    // nav hydration from completing — modules just stay at their default (enabled).
    try {
      const modRes = await fetch('/api/modules', { credentials: 'same-origin' });
      if (modRes.ok) {
        const { modules } = (await modRes.json()) as { modules: Record<string, boolean> };
        for (const [id, on] of Object.entries(modules)) {
          enabled[id] = on;
        }
        // Re-assign so Svelte 5 $derived consumers re-run after the merge.
        pluginNavState.enabledByPluginId = { ...enabled };
      }
    } catch {
      // Non-fatal: modules stay at default (enabled).
    }
    pluginNavState.loaded = true;
  } catch (err) {
    pluginNavState.error = err instanceof Error ? err.message : String(err);
    pluginNavState.loaded = true;
  }
}

/**
 * Optimistically reflect a per-org plugin enable/disable in the nav store so the
 * sidebar reacts immediately after a toggle — no reload, no gateway restart.
 * Reassigns the record (not in-place mutation) so Svelte 5 `$derived` consumers
 * re-run.
 */
export function setPluginEnabled(pluginId: string, enabled: boolean): void {
  pluginNavState.enabledByPluginId = {
    ...pluginNavState.enabledByPluginId,
    [pluginId]: enabled,
  };
}
