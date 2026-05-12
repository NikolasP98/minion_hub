import { describe, it, expect } from "vitest";
import { SLOT_DEFINITIONS, isPluginSlot } from "./slots";

describe("slots", () => {
  it("SLOT_DEFINITIONS has settings.plugins entry", () => {
    expect(SLOT_DEFINITIONS["settings.plugins"]).toBeDefined();
    expect(SLOT_DEFINITIONS["settings.plugins"].layout).toBe("tabs");
  });

  it("isPluginSlot accepts known slot", () => {
    expect(isPluginSlot("settings.plugins")).toBe(true);
  });

  it("isPluginSlot rejects unknown slot", () => {
    expect(isPluginSlot("not.a.slot")).toBe(false);
  });
});
