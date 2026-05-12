import { describe, it, expect, vi } from "vitest";
import PluginIframe from "./PluginIframe.svelte";

vi.mock("./bridge-host", () => ({
  mountHostBridge: vi.fn(() => ({ dispose: vi.fn(), sendThemeChange: vi.fn(), bridge: {} })),
}));

describe("PluginIframe", () => {
  it("is a Svelte component (defined)", () => {
    expect(PluginIframe).toBeDefined();
  });

  it("is truthy (compiled Svelte 5 component)", () => {
    expect(!!PluginIframe).toBe(true);
  });
});
