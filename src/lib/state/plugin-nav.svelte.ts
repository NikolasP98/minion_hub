import type { PluginUiManifestOccupant } from "$lib/plugins/PluginSlotHost.svelte";

export const pluginNavState = $state<{
  controlCenters: PluginUiManifestOccupant[];
  loaded: boolean;
  error: string | null;
}>({ controlCenters: [], loaded: false, error: null });

export async function hydratePluginNav(): Promise<void> {
  if (pluginNavState.loaded) return;
  try {
    const res = await fetch("/api/plugins/ui-list", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { entries } = (await res.json()) as { entries: PluginUiManifestOccupant[] };
    pluginNavState.controlCenters = entries.filter(
      (e) => e.slot === "plugins.controlCenter",
    );
    pluginNavState.loaded = true;
  } catch (err) {
    pluginNavState.error = err instanceof Error ? err.message : String(err);
    pluginNavState.loaded = true;
  }
}
