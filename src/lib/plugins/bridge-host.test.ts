import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountHostBridge } from "./bridge-host";

class FakeWindow {
  listeners: Array<(e: MessageEvent) => void> = [];
  posted: Array<{ data: unknown; origin: string }> = [];
  addEventListener = vi.fn((_: string, fn: (e: MessageEvent) => void) => {
    this.listeners.push(fn);
  });
  removeEventListener = vi.fn();
  postMessage = vi.fn((data: unknown, targetOrigin: string) => {
    this.posted.push({ data, origin: targetOrigin });
  });
  emit(data: unknown, origin: string, source?: unknown) {
    for (const l of this.listeners) l({ data, origin, source } as MessageEvent);
  }
}

describe("mountHostBridge", () => {
  let hostWin: FakeWindow;
  let iframeWin: FakeWindow;

  beforeEach(() => {
    hostWin = new FakeWindow();
    iframeWin = new FakeWindow();
  });

  it("sends host:hello after plugin:ready from correct origin", () => {
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://gw.example.com",
      hello: {
        theme: "dark",
        tokens: { bg: "#000" },
        gatewayUrl: "wss://gw",
        authToken: "tok",
      },
    });
    hostWin.emit({ type: "plugin:ready" }, "https://gw.example.com");
    expect(iframeWin.posted).toHaveLength(1);
    bridge.dispose();
  });

  it("sandboxed: accepts opaque-origin peer by source identity + posts with '*'", () => {
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://hub.example.com",
      sandboxed: true,
      hello: { theme: "dark", tokens: {}, gatewayUrl: "", authToken: "" },
    });
    // opaque-origin sandboxed iframe posts with origin "null" but is the real target window
    hostWin.emit({ type: "plugin:ready" }, "null", iframeWin);
    expect(iframeWin.posted).toHaveLength(1);
    expect(iframeWin.posted[0].origin).toBe("*"); // reaches the opaque-origin peer
    bridge.dispose();
  });

  it("sandboxed: ignores a message from a window that is not the target", () => {
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://hub.example.com",
      sandboxed: true,
      hello: { theme: "dark", tokens: {}, gatewayUrl: "", authToken: "" },
    });
    const otherWin = new FakeWindow();
    hostWin.emit({ type: "plugin:ready" }, "null", otherWin);
    expect(iframeWin.posted).toHaveLength(0);
    bridge.dispose();
  });

  it("ignores plugin:ready from wrong origin", () => {
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://gw.example.com",
      hello: { theme: "dark", tokens: {}, gatewayUrl: "wss://gw", authToken: "tok" },
    });
    hostWin.emit({ type: "plugin:ready" }, "https://evil.example.com");
    expect(iframeWin.posted).toHaveLength(0);
    bridge.dispose();
  });

  it("relays resize via onResize", () => {
    const onResize = vi.fn();
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://gw.example.com",
      hello: { theme: "dark", tokens: {}, gatewayUrl: "wss://gw", authToken: "tok" },
      onResize,
    });
    hostWin.emit({ type: "plugin:resize", height: 420 }, "https://gw.example.com");
    expect(onResize).toHaveBeenCalledWith(420);
    bridge.dispose();
  });

  it("dispose removes listeners", () => {
    const bridge = mountHostBridge({
      self: hostWin as unknown as Window,
      target: iframeWin as unknown as Window,
      pluginOrigin: "https://gw.example.com",
      hello: { theme: "dark", tokens: {}, gatewayUrl: "wss://gw", authToken: "tok" },
    });
    bridge.dispose();
    expect(hostWin.removeEventListener).toHaveBeenCalled();
  });
});
