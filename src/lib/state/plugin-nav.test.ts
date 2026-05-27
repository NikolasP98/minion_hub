import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDynamicPluginsSection } from "$lib/components/layout/sections";

describe("getDynamicPluginsSection", () => {
  it("returns null when no control centers", () => {
    expect(getDynamicPluginsSection([])).toBe(null);
  });

  it("returns a section with one item per control center", () => {
    const section = getDynamicPluginsSection([
      {
        pluginId: "x",
        slot: "plugins.controlCenter",
        title: "X",
        description: "",
        entrypoint: "c.html",
      },
    ]);
    expect(section?.items).toHaveLength(1);
    expect(section?.items[0]?.href).toBe("/plugins/x");
    expect(section?.id).toBe("plugins");
  });
});

describe("hydratePluginNav — enabledByPluginId", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [
            {
              pluginId: "flows",
              slot: "settings.plugins",
              configEnabled: false,
              title: "Flows",
              entrypoint: "flows.html",
            },
            {
              pluginId: "whatsapp",
              slot: "settings.plugins",
              // configEnabled absent — should default to true
              title: "WhatsApp",
              entrypoint: "whatsapp.html",
            },
          ],
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("populates enabledByPluginId from entries' configEnabled (absent ⇒ true)", async () => {
    const { pluginNavState, hydratePluginNav } = await import(
      "$lib/state/plugin-nav.svelte"
    );
    pluginNavState.loaded = false;
    await hydratePluginNav();
    expect(pluginNavState.enabledByPluginId.flows).toBe(false);
    expect(pluginNavState.enabledByPluginId.whatsapp).toBe(true);
  });
});
