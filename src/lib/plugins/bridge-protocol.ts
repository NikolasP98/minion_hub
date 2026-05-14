// Inlined from @minion-stack/plugin-ui-bridge until that package is published.
// Phase B can refactor to import from the npm package.

export type Theme = "light" | "dark";

export type HostToPlugin =
  | {
      type: "host:hello";
      theme: Theme;
      tokens: Record<string, string>;
      gatewayUrl: string;
      authToken: string;
    }
  | {
      type: "host:theme-change";
      theme: Theme;
      tokens: Record<string, string>;
    };

export type PluginToHost =
  | { type: "plugin:ready" }
  | { type: "plugin:resize"; height: number }
  | { type: "plugin:notify"; level: "info" | "warn" | "error"; message: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isPluginToHost(v: unknown): v is PluginToHost {
  if (!isObject(v)) return false;
  const t = v.type;
  return t === "plugin:ready" || t === "plugin:resize" || t === "plugin:notify";
}

export interface HostBridgeOptions {
  self: Window;
  target: Window;
  pluginOrigin: string;
}

export class HostBridge {
  private pendingHelloPayload: Omit<Extract<HostToPlugin, { type: "host:hello" }>, "type"> | null =
    null;
  // Buffer the plugin:ready signal in case it arrives before sendHelloOnReady
  // has been called. Without this, hello is silently dropped and the plugin
  // hangs waiting for host:hello forever (race when the iframe's notifyReady()
  // fires before the host registers its message listener / sets the payload).
  private pluginReady = false;
  private resizeHandlers: Array<(height: number) => void> = [];
  private notifyHandlers: Array<(level: "info" | "warn" | "error", message: string) => void> = [];

  constructor(private opts: HostBridgeOptions) {
    opts.self.addEventListener("message", this.handle);
  }

  private handle = (ev: MessageEvent): void => {
    if (ev.origin !== this.opts.pluginOrigin) return;
    if (!isPluginToHost(ev.data)) return;
    if (ev.data.type === "plugin:ready") {
      this.pluginReady = true;
      this.flushHello();
    } else if (ev.data.type === "plugin:resize") {
      const { height } = ev.data;
      for (const h of this.resizeHandlers) h(height);
    } else if (ev.data.type === "plugin:notify") {
      const { level, message } = ev.data;
      for (const h of this.notifyHandlers) h(level, message);
    }
  };

  sendHelloOnReady(
    payload: Omit<Extract<HostToPlugin, { type: "host:hello" }>, "type">,
  ): void {
    this.pendingHelloPayload = payload;
    this.flushHello();
  }

  private flushHello(): void {
    if (!this.pluginReady || !this.pendingHelloPayload) return;
    const msg: HostToPlugin = { type: "host:hello", ...this.pendingHelloPayload };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
  }

  sendThemeChange(payload: { theme: Theme; tokens: Record<string, string> }): void {
    const msg: HostToPlugin = { type: "host:theme-change", ...payload };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
  }

  onResize(fn: (height: number) => void): void {
    this.resizeHandlers.push(fn);
  }

  onNotify(fn: (level: "info" | "warn" | "error", message: string) => void): void {
    this.notifyHandlers.push(fn);
  }

  dispose(): void {
    this.opts.self.removeEventListener("message", this.handle);
    this.pendingHelloPayload = null;
    this.resizeHandlers = [];
    this.notifyHandlers = [];
  }
}
