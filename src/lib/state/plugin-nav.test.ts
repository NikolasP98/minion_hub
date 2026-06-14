import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDynamicPluginsSections } from "$lib/components/layout/sections";

describe("getDynamicPluginsSections", () => {
  it("returns just the Tools group (built-in Kanban + CRM) when no control centers", () => {
    const sections = getDynamicPluginsSections([]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("plugins:tool");
    expect(sections[0]?.label).toBe("Tools");
    expect(sections[0]?.items.map((i) => i.href)).toEqual(["/workforce", "/crm"]);
    expect(sections[0]?.items[0]?.label).toBe("Kanban");
    expect(sections[0]?.items[1]?.label).toBe("CRM");
  });

  it("buckets plugins into category groups (channel vs creative), Kanban under Tools", () => {
    const sections = getDynamicPluginsSections([
      {
        pluginId: "whatsapp",
        slot: "plugins.controlCenter",
        title: "WhatsApp",
        description: "",
        entrypoint: "c.html",
        category: "channel",
      },
      {
        pluginId: "studio",
        slot: "plugins.controlCenter",
        title: "Studio",
        description: "",
        entrypoint: "c.html",
        category: "creative",
      },
    ]);
    // Display order: Channels, Creative, Tools.
    expect(sections.map((s) => s.id)).toEqual([
      "plugins:channel",
      "plugins:creative",
      "plugins:tool",
    ]);
    const channels = sections.find((s) => s.id === "plugins:channel");
    expect(channels?.items[0]?.href).toBe("/plugins/whatsapp");
    const tools = sections.find((s) => s.id === "plugins:tool");
    expect(tools?.items[0]?.href).toBe("/workforce");
  });

  it("falls back to the Tools group for entries with no category", () => {
    const sections = getDynamicPluginsSections([
      {
        pluginId: "x",
        slot: "plugins.controlCenter",
        title: "X",
        description: "",
        entrypoint: "c.html",
      },
    ]);
    const tools = sections.find((s) => s.id === "plugins:tool");
    expect(tools?.items.map((i) => i.href)).toEqual(["/workforce", "/crm", "/plugins/x"]);
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
