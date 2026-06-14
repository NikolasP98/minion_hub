// Inlined from @minion-stack/plugin-ui-bridge until that package is published.
// Phase B can refactor to import from the npm package.

export type Theme = "light" | "dark";

/** UI locale the host is rendering in; plugins mirror it. */
export type Locale = "en" | "es";

export type HostToPlugin =
  | {
      type: "host:hello";
      theme: Theme;
      tokens: Record<string, string>;
      gatewayUrl: string;
      authToken: string;
      /** Host UI locale; optional for backward-compat (plugins fall back to "en"). */
      locale?: Locale;
    }
  | {
      type: "host:theme-change";
      theme: Theme;
      tokens: Record<string, string>;
    }
  | {
      type: "host:locale-change";
      locale: Locale;
    }
  | {
      type: "host:rpc-response";
      id: string;
      ok: boolean;
      payload?: unknown;
      error?: { code?: string; message?: string };
    }
  | {
      // Hub-rendered Save click. Plugin runs save flow + replies with
      // plugin:save-result echoing the same id. See bridge-protocol notes
      // in @nikolasp98/plugin-ui-bridge v0.2.0.
      type: "host:save";
      id: string;
    };

export type PluginToHost =
  | { type: "plugin:ready" }
  | { type: "plugin:resize"; height: number }
  | { type: "plugin:notify"; level: "info" | "warn" | "error"; message: string }
  | {
      type: "plugin:rpc-request";
      id: string;
      method: string;
      params?: unknown;
    }
  | { type: "plugin:dirty-changed"; dirty: boolean }
  | {
      type: "plugin:save-result";
      id: string;
      ok: boolean;
      error?: string;
      restartRequired?: boolean;
    };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isPluginToHost(v: unknown): v is PluginToHost {
  if (!isObject(v)) return false;
  const t = v.type;
  return (
    t === "plugin:ready" ||
    t === "plugin:resize" ||
    t === "plugin:notify" ||
    t === "plugin:rpc-request" ||
    t === "plugin:dirty-changed" ||
    t === "plugin:save-result"
  );
}

export interface HostBridgeOptions {
  self: Window;
  target: Window;
  pluginOrigin: string;
  /**
   * Forward a plugin RPC request through the host's privileged gateway WS.
   * Resolves with the gateway response payload or rejects with an Error.
   * Wired by mountHostBridge in bridge-host.ts; without it plugin:rpc-request
   * messages are dropped (legacy plugins that don't use bridge.call still work).
   */
  forwardRpc?: (method: string, params: unknown) => Promise<unknown>;
}

export class HostBridge {
  private pendingHelloPayload: Omit<Extract<HostToPlugin, { type: "host:hello" }>, "type"> | null =
    null;
  // Theme-change is buffered the same way as hello: posting before the iframe
  // navigates from about:blank to the plugin origin yields a postMessage
  // targetOrigin mismatch (about:blank inherits the parent's origin). Hold the
  // latest payload and flush after plugin:ready.
  private pendingThemePayload: { theme: Theme; tokens: Record<string, string> } | null = null;
  // Locale-change buffered the same way as theme-change (see above).
  private pendingLocalePayload: { locale: Locale } | null = null;
  // Buffer the plugin:ready signal in case it arrives before sendHelloOnReady
  // has been called. Without this, hello is silently dropped and the plugin
  // hangs waiting for host:hello forever (race when the iframe's notifyReady()
  // fires before the host registers its message listener / sets the payload).
  private pluginReady = false;
  private resizeHandlers: Array<(height: number) => void> = [];
  private notifyHandlers: Array<(level: "info" | "warn" | "error", message: string) => void> = [];
  private readyHandlers: Array<() => void> = [];
  private dirtyHandlers: Array<(dirty: boolean) => void> = [];
  private saveResultHandlers: Array<
    (id: string, ok: boolean, error?: string, restartRequired?: boolean) => void
  > = [];
  private saveSeq = 0;

  constructor(private opts: HostBridgeOptions) {
    opts.self.addEventListener("message", this.handle);
  }

  private handle = (ev: MessageEvent): void => {
    if (ev.origin !== this.opts.pluginOrigin) return;
    if (!isPluginToHost(ev.data)) return;
    if (ev.data.type === "plugin:ready") {
      const wasReady = this.pluginReady;
      this.pluginReady = true;
      this.flushHello();
      this.flushTheme();
      this.flushLocale();
      if (!wasReady) for (const h of this.readyHandlers) h();
    } else if (ev.data.type === "plugin:resize") {
      const { height } = ev.data;
      for (const h of this.resizeHandlers) h(height);
    } else if (ev.data.type === "plugin:notify") {
      const { level, message } = ev.data;
      for (const h of this.notifyHandlers) h(level, message);
    } else if (ev.data.type === "plugin:dirty-changed") {
      const { dirty } = ev.data;
      for (const h of this.dirtyHandlers) h(dirty);
    } else if (ev.data.type === "plugin:save-result") {
      const { id, ok, error, restartRequired } = ev.data;
      for (const h of this.saveResultHandlers) h(id, ok, error, restartRequired);
    } else if (ev.data.type === "plugin:rpc-request") {
      const { id, method, params } = ev.data;
      const forward = this.opts.forwardRpc;
      if (!forward) {
        this.replyRpc(id, false, undefined, {
          code: "no-forwarder",
          message: "host has no forwardRpc configured",
        });
        return;
      }
      Promise.resolve()
        .then(() => forward(method, params))
        .then((payload) => this.replyRpc(id, true, payload))
        .catch((err: unknown) =>
          this.replyRpc(id, false, undefined, {
            code: "rpc-failed",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
    }
  };

  private replyRpc(
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { code?: string; message?: string },
  ): void {
    const msg: HostToPlugin = { type: "host:rpc-response", id, ok, payload, error };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
  }

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
    this.pendingThemePayload = payload;
    this.flushTheme();
  }

  private flushTheme(): void {
    if (!this.pluginReady || !this.pendingThemePayload) return;
    const msg: HostToPlugin = { type: "host:theme-change", ...this.pendingThemePayload };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
    this.pendingThemePayload = null;
  }

  sendLocaleChange(locale: Locale): void {
    this.pendingLocalePayload = { locale };
    this.flushLocale();
  }

  private flushLocale(): void {
    if (!this.pluginReady || !this.pendingLocalePayload) return;
    const msg: HostToPlugin = { type: "host:locale-change", ...this.pendingLocalePayload };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
    this.pendingLocalePayload = null;
  }

  onResize(fn: (height: number) => void): void {
    this.resizeHandlers.push(fn);
  }

  onNotify(fn: (level: "info" | "warn" | "error", message: string) => void): void {
    this.notifyHandlers.push(fn);
  }

  onPluginReady(fn: () => void): void {
    if (this.pluginReady) fn();
    else this.readyHandlers.push(fn);
  }

  onDirtyChanged(fn: (dirty: boolean) => void): void {
    this.dirtyHandlers.push(fn);
  }

  onSaveResult(
    fn: (id: string, ok: boolean, error?: string, restartRequired?: boolean) => void,
  ): void {
    this.saveResultHandlers.push(fn);
  }

  /**
   * Trigger the plugin's save flow. Returns the request id; pair with
   * onSaveResult to observe completion.
   */
  requestSave(): string {
    const id = `save-${++this.saveSeq}-${Date.now()}`;
    const msg: HostToPlugin = { type: "host:save", id };
    this.opts.target.postMessage(msg, this.opts.pluginOrigin);
    return id;
  }

  dispose(): void {
    this.opts.self.removeEventListener("message", this.handle);
    this.pendingHelloPayload = null;
    this.pendingThemePayload = null;
    this.resizeHandlers = [];
    this.notifyHandlers = [];
    this.readyHandlers = [];
    this.dirtyHandlers = [];
    this.saveResultHandlers = [];
  }
}
