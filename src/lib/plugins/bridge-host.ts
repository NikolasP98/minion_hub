import { HostBridge, type Theme } from "./bridge-protocol";

export interface MountHostBridgeOptions {
  self: Window;
  target: Window;
  pluginOrigin: string;
  hello: {
    theme: Theme;
    tokens: Record<string, string>;
    gatewayUrl: string;
    authToken: string;
  };
  onResize?: (height: number) => void;
  onNotify?: (level: "info" | "warn" | "error", message: string) => void;
  onPluginReady?: () => void;
  forwardRpc?: (method: string, params: unknown) => Promise<unknown>;
}

export interface MountedHostBridge {
  bridge: HostBridge;
  dispose: () => void;
  sendThemeChange: (theme: Theme, tokens: Record<string, string>) => void;
}

export function mountHostBridge(opts: MountHostBridgeOptions): MountedHostBridge {
  const bridge = new HostBridge({
    self: opts.self,
    target: opts.target,
    pluginOrigin: opts.pluginOrigin,
    forwardRpc: opts.forwardRpc,
  });
  bridge.sendHelloOnReady(opts.hello);
  if (opts.onResize) bridge.onResize(opts.onResize);
  if (opts.onNotify) bridge.onNotify(opts.onNotify);
  if (opts.onPluginReady) bridge.onPluginReady(opts.onPluginReady);
  return {
    bridge,
    dispose: () => bridge.dispose(),
    sendThemeChange: (theme, tokens) => bridge.sendThemeChange({ theme, tokens }),
  };
}
