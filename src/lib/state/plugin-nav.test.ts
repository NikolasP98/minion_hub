import { describe, it, expect } from "vitest";
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
