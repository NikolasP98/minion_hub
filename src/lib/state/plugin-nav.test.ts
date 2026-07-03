import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDynamicPluginsSections } from "$lib/components/layout/sections";

describe("getDynamicPluginsSections", () => {
  it("surfaces built-in CRM under Marketing and Kanban under Operations when no control centers", () => {
    const sections = getDynamicPluginsSections([]);
    // Display order: Marketing (CRM), Operations (Workforce, Scheduling), Finance
    // (builtin Finances), Customer Support (builtin Support).
    expect(sections.map((s) => s.id)).toEqual([
      "plugins:marketing",
      "plugins:operations",
      "plugins:finance",
      "plugins:customer-support",
    ]);
    const marketing = sections.find((s) => s.id === "plugins:marketing");
    expect(marketing?.label).toBe("Marketing");
    expect(marketing?.items.map((i) => i.href)).toEqual(["/crm"]);
    expect(marketing?.items[0]?.label).toBe("CRM");
    const operations = sections.find((s) => s.id === "plugins:operations");
    expect(operations?.label).toBe("Operations");
    expect(operations?.items.map((i) => i.href)).toEqual(["/work", "/workforce", "/scheduling", "/stock"]);
    expect(operations?.items[0]?.label).toBe("My Work");
    expect(operations?.items[1]?.label).toBe("Workforce");
    expect(operations?.items[2]?.label).toBe("Scheduling");
    expect(operations?.items[3]?.label).toBe("Stock");
    const finance = sections.find((s) => s.id === "plugins:finance");
    expect(finance?.items.map((i) => i.href)).toEqual(["/finances", "/sales", "/memberships"]);
    const support = sections.find((s) => s.id === "plugins:customer-support");
    expect(support?.items.map((i) => i.href)).toEqual(["/support"]);
  });

  it("folds channel plugins into a single Channels link under Customer Support, Studio under Branding/Creative", () => {
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
        // voice-call is pinned to customer-support via PLUGIN_CATEGORY_OVERRIDES
        // even though its manifest category is "tool".
        pluginId: "voice-call",
        slot: "plugins.controlCenter",
        title: "Voice Call",
        description: "",
        entrypoint: "c.html",
        category: "tool",
      },
    ]);
    // Display order: Marketing, Operations, Finance (builtin), Branding/Creative, Customer Support.
    expect(sections.map((s) => s.id)).toEqual([
      "plugins:marketing",
      "plugins:operations",
      "plugins:finance",
      "plugins:creative",
      "plugins:customer-support",
    ]);
    const creative = sections.find((s) => s.id === "plugins:creative");
    expect(creative?.items[0]?.href).toBe("/plugins/studio");
    const cs = sections.find((s) => s.id === "plugins:customer-support");
    // builtin Support, then voice-call (pinned via overrides), then the single
    // Channels link (the channels themselves live on the /channels side-menu).
    expect(cs?.items.map((i) => i.href)).toEqual(["/support", "/plugins/voice-call", "/channels"]);
    // Channel plugins are NOT a top-level group nor individual nav items.
    expect(sections.some((s) => s.id === "plugins:channel")).toBe(false);
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

  it("hides a plugin item entirely when disabled for the org", () => {
    const entries = [
      { pluginId: "studio", slot: "plugins.controlCenter" as const, title: "Studio", description: "", entrypoint: "c.html", category: "creative" as const },
      { pluginId: "x", slot: "plugins.controlCenter" as const, title: "X", description: "", entrypoint: "c.html" },
    ];
    const sections = getDynamicPluginsSections(entries, { studio: false, x: true });
    // studio is disabled → its category section is gone entirely (no item).
    expect(sections.some((s) => s.id === "plugins:creative")).toBe(false);
    // x stays visible.
    expect(sections.find((s) => s.id === "plugins:tool")?.items.map((i) => i.href)).toEqual([
      "/plugins/x",
    ]);
    // Built-in items (CRM/Kanban) are unaffected by per-org plugin state.
    expect(sections.find((s) => s.id === "plugins:marketing")?.items[0]?.href).toBe("/crm");
  });

  it("shows the Channels link while any channel is enabled, drops it when all are disabled", () => {
    const entries = [
      { pluginId: "whatsapp", slot: "plugins.controlCenter" as const, title: "WhatsApp", description: "", entrypoint: "c.html", category: "channel" as const },
      { pluginId: "telegram", slot: "plugins.controlCenter" as const, title: "Telegram", description: "", entrypoint: "c.html", category: "channel" as const },
    ];
    // whatsapp disabled, telegram still on → Channels link present.
    const some = getDynamicPluginsSections(entries, { whatsapp: false });
    const csSome = some.find((s) => s.id === "plugins:customer-support");
    expect(csSome?.items.some((i) => i.href === "/channels")).toBe(true);

    // all channels disabled → no Channels link.
    const none = getDynamicPluginsSections(entries, { whatsapp: false, telegram: false });
    const csNone = none.find((s) => s.id === "plugins:customer-support");
    expect(csNone?.items.some((i) => i.href === "/channels")).toBe(false);
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

describe("hydratePluginNav — orgEnabled precedence + setPluginEnabled", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [
            // orgEnabled=false must win even though globally configEnabled=true.
            { pluginId: "discord", slot: "settings.plugins", configEnabled: true, orgEnabled: false, title: "Discord", entrypoint: "d.html" },
            { pluginId: "telegram", slot: "settings.plugins", configEnabled: true, orgEnabled: true, title: "Telegram", entrypoint: "t.html" },
          ],
        }),
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("prefers per-org orgEnabled over global configEnabled", async () => {
    const { pluginNavState, hydratePluginNav } = await import("$lib/state/plugin-nav.svelte");
    pluginNavState.loaded = false;
    await hydratePluginNav();
    expect(pluginNavState.enabledByPluginId.discord).toBe(false);
    expect(pluginNavState.enabledByPluginId.telegram).toBe(true);
  });

  it("setPluginEnabled flips state reactively (new object identity)", async () => {
    const { pluginNavState, hydratePluginNav, setPluginEnabled } = await import(
      "$lib/state/plugin-nav.svelte"
    );
    pluginNavState.loaded = false;
    await hydratePluginNav();
    const before = pluginNavState.enabledByPluginId;
    setPluginEnabled("discord", true);
    expect(pluginNavState.enabledByPluginId.discord).toBe(true);
    // Reassigned (not mutated) so Svelte $derived consumers re-run.
    expect(pluginNavState.enabledByPluginId).not.toBe(before);
  });
});
