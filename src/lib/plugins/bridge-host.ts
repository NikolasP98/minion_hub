import { HostBridge, type Theme, type Locale } from "./bridge-protocol";

export interface MountHostBridgeOptions {
  self: Window;
  target: Window;
  pluginOrigin: string;
  /** Peer iframe is sandboxed (opaque origin) — see HostBridgeOptions.sandboxed. */
  sandboxed?: boolean;
  hello: {
    theme: Theme;
    tokens: Record<string, string>;
    gatewayUrl: string;
    authToken: string;
    locale?: Locale;
  };
  onResize?: (height: number) => void;
  onNotify?: (level: "info" | "warn" | "error", message: string) => void;
  onPluginReady?: () => void;
  onDirtyChanged?: (dirty: boolean) => void;
  onSaveResult?: (id: string, ok: boolean, error?: string, restartRequired?: boolean) => void;
  forwardRpc?: (method: string, params: unknown) => Promise<unknown>;
}

export interface MountedHostBridge {
  bridge: HostBridge;
  dispose: () => void;
  sendThemeChange: (theme: Theme, tokens: Record<string, string>) => void;
  sendLocaleChange: (locale: Locale) => void;
  requestSave: () => string;
}

export function mountHostBridge(opts: MountHostBridgeOptions): MountedHostBridge {
  const bridge = new HostBridge({
    self: opts.self,
    target: opts.target,
    pluginOrigin: opts.pluginOrigin,
    sandboxed: opts.sandboxed,
    forwardRpc: opts.forwardRpc,
  });
  bridge.sendHelloOnReady(opts.hello);
  if (opts.onResize) bridge.onResize(opts.onResize);
  if (opts.onNotify) bridge.onNotify(opts.onNotify);
  if (opts.onPluginReady) bridge.onPluginReady(opts.onPluginReady);
  if (opts.onDirtyChanged) bridge.onDirtyChanged(opts.onDirtyChanged);
  if (opts.onSaveResult) bridge.onSaveResult(opts.onSaveResult);
  return {
    bridge,
    dispose: () => bridge.dispose(),
    sendThemeChange: (theme, tokens) => bridge.sendThemeChange({ theme, tokens }),
    sendLocaleChange: (locale) => bridge.sendLocaleChange(locale),
    requestSave: () => bridge.requestSave(),
  };
}
