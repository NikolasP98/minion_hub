import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDynamicPluginsSections } from "$lib/components/layout/sections";

describe("getDynamicPluginsSections", () => {
  it("surfaces built-in CRM under Marketing and Kanban under Operations when no control centers", () => {
    const sections = getDynamicPluginsSections([]);
    // Display order: Marketing (CRM), Operations (Kanban).
    expect(sections.map((s) => s.id)).toEqual(["plugins:marketing", "plugins:operations"]);
    const marketing = sections.find((s) => s.id === "plugins:marketing");
    expect(marketing?.label).toBe("Marketing");
    expect(marketing?.items.map((i) => i.href)).toEqual(["/crm"]);
    expect(marketing?.items[0]?.label).toBe("CRM");
    const operations = sections.find((s) => s.id === "plugins:operations");
    expect(operations?.label).toBe("Operations");
    expect(operations?.items.map((i) => i.href)).toEqual(["/workforce"]);
    expect(operations?.items[0]?.label).toBe("Kanban");
  });

  it("folds channel plugins into a Channels subsection under Customer Support, Studio under Branding/Creative", () => {
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
      {
        pluginId: "alerts",
        slot: "plugins.controlCenter",
        title: "Alert Watcher",
        description: "",
        entrypoint: "c.html",
        category: "customer-support",
      },
    ]);
    // Display order: Marketing, Operations, Branding/Creative, Customer Support.
    expect(sections.map((s) => s.id)).toEqual([
      "plugins:marketing",
      "plugins:operations",
      "plugins:creative",
      "plugins:customer-support",
    ]);
    const creative = sections.find((s) => s.id === "plugins:creative");
    expect(creative?.items[0]?.href).toBe("/plugins/studio");
    const cs = sections.find((s) => s.id === "plugins:customer-support");
    expect(cs?.items.map((i) => i.href)).toEqual(["/plugins/alerts"]);
    // Channel plugins are NOT a top-level group — they live in a subsection.
    expect(sections.some((s) => s.id === "plugins:channel")).toBe(false);
    expect(cs?.subsections?.[0]?.id).toBe("channels");
    expect(cs?.subsections?.[0]?.items.map((i) => i.href)).toEqual(["/plugins/whatsapp"]);
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
    expect(tools?.items.map((i) => i.href)).toEqual(["/plugins/x"]);
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
