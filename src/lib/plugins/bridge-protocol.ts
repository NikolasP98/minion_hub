// The shared postMessage protocol (message types + BRIDGE_PROTOCOL_VERSION) is
// owned by @nikolasp98/plugin-ui-bridge — the same package the plugin UIs use,
// so the two sides can't drift. This module keeps only the *host* side: the
// richer HostBridge class (RPC forwarding, dirty/save buffering, hello/theme/
// locale flush) that the hub needs and the package intentionally doesn't ship.
import {
  BRIDGE_PROTOCOL_VERSION,
  type Theme,
  type Locale,
  type HostToPlugin,
  type PluginToHost,
} from '@nikolasp98/plugin-ui-bridge';

export { BRIDGE_PROTOCOL_VERSION };
export type { Theme, Locale, HostToPlugin, PluginToHost };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function nonempty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function version1(v: Record<string, unknown>): boolean {
  return !('protocolVersion' in v) || v.protocolVersion === BRIDGE_PROTOCOL_VERSION;
}
function tokens(v: unknown): boolean {
  return isObject(v) && Object.values(v).every((x) => typeof x === 'string');
}
function theme(v: unknown): boolean {
  return v === 'light' || v === 'dark';
}
function locale(v: unknown): boolean {
  return v === 'en' || v === 'es';
}
function optionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}
function exactOrigin(value: string): boolean {
  try {
    return value !== 'null' && new URL(value).origin === value;
  } catch {
    return false;
  }
}
function isPluginToHost(v: unknown): v is PluginToHost {
  if (!isObject(v)) return false;
  switch (v.type) {
    case 'plugin:ready':
      return version1(v);
    case 'plugin:resize':
      return typeof v.height === 'number' && Number.isFinite(v.height) && v.height >= 0;
    case 'plugin:notify':
      return (
        (v.level === 'info' || v.level === 'warn' || v.level === 'error') &&
        typeof v.message === 'string'
      );
    case 'plugin:rpc-request':
      return nonempty(v.id) && nonempty(v.method);
    case 'plugin:dirty-changed':
      return typeof v.dirty === 'boolean';
    case 'plugin:save-result':
      return (
        nonempty(v.id) &&
        typeof v.ok === 'boolean' &&
        optionalString(v.error) &&
        (v.restartRequired === undefined || typeof v.restartRequired === 'boolean')
      );
    default:
      return false;
  }
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
  /**
   * The peer iframe is sandboxed (cross-origin, opaque origin) — e.g. an
   * untrusted artifact bundle served with `sandbox="allow-scripts"`. Its
   * messages arrive with `origin === "null"` and it can only be reached with
   * targetOrigin `"*"`. When set, inbound messages are validated by source
   * window identity (`ev.source === target`) AND origin `null`; outbound
   * posts use `"*"`. Leave false for ordinary plugins.
   */
  sandboxed?: boolean;
}

export class HostBridge {
  private disposed = false;
  private helloSent = false;
  private inflight = new Set<string>();
  private saves = new Set<string>();
  // targetOrigin for outbound posts: a sandboxed (opaque-origin) peer can only
  // be reached with "*"; same-origin plugins are pinned to their exact origin.
  private get targetOrigin(): string {
    return this.opts.sandboxed ? '*' : this.opts.pluginOrigin;
  }
  private pendingHelloPayload: Omit<Extract<HostToPlugin, { type: 'host:hello' }>, 'type'> | null =
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
  // Plugin's advertised bridge protocol version, captured from plugin:ready.
  // Null until ready; a pre-versioning plugin omits it and is reported as 1.
  private _pluginProtocolVersion: number | null = null;
  private resizeHandlers: Array<(height: number) => void> = [];
  private notifyHandlers: Array<(level: 'info' | 'warn' | 'error', message: string) => void> = [];
  private readyHandlers: Array<() => void> = [];
  private dirtyHandlers: Array<(dirty: boolean) => void> = [];
  private saveResultHandlers: Array<
    (id: string, ok: boolean, error?: string, restartRequired?: boolean) => void
  > = [];
  private saveSeq = 0;

  constructor(private opts: HostBridgeOptions) {
    opts.self.addEventListener('message', this.handle);
  }

  private handle = (ev: MessageEvent): void => {
    if (this.disposed || ev.source !== this.opts.target) return;
    if (
      this.opts.sandboxed
        ? ev.origin !== 'null'
        : !exactOrigin(this.opts.pluginOrigin) || ev.origin !== this.opts.pluginOrigin
    )
      return;
    if (!isPluginToHost(ev.data)) return;
    if (ev.data.type === 'plugin:ready') {
      const wasReady = this.pluginReady;
      this.pluginReady = true;
      this._pluginProtocolVersion = ev.data.protocolVersion ?? 1;
      this.flushHello();
      this.flushTheme();
      this.flushLocale();
      if (!wasReady) for (const h of this.readyHandlers) h();
    } else if (ev.data.type === 'plugin:resize') {
      const { height } = ev.data;
      for (const h of this.resizeHandlers) h(height);
    } else if (ev.data.type === 'plugin:notify') {
      const { level, message } = ev.data;
      for (const h of this.notifyHandlers) h(level, message);
    } else if (ev.data.type === 'plugin:dirty-changed') {
      const { dirty } = ev.data;
      for (const h of this.dirtyHandlers) h(dirty);
    } else if (ev.data.type === 'plugin:save-result') {
      const { id, ok, error, restartRequired } = ev.data;
      if (!this.saves.delete(id)) return;
      for (const h of this.saveResultHandlers) h(id, ok, error, restartRequired);
    } else if (ev.data.type === 'plugin:rpc-request') {
      const { id, method, params } = ev.data;
      if (!this.pluginReady || !this.helloSent || this.inflight.has(id)) return;
      // TODO(handoff): Gate constrained capabilities before component mounting, audit token/method authority,
      // and qualify handwritten artifact peers/generator plus browser/release adoption; see 14-PLUGIN-BRIDGE-MATRIX.md.

      const forward = this.opts.forwardRpc;
      if (!forward) {
        this.replyRpc(id, false, undefined, {
          code: 'no-forwarder',
          message: 'host has no forwardRpc configured',
        });
        return;
      }
      this.inflight.add(id);
      void Promise.resolve()
        .then(() => (this.disposed ? undefined : forward(method, params)))
        .then((payload) => this.replyRpc(id, true, payload))
        .catch((err: unknown) =>
          this.replyRpc(id, false, undefined, {
            code: 'rpc-failed',
            // TODO(handoff): Replace raw upstream error messages with an approved safe RPC projection;
            // see proposals/2026-09-08-platform-qc-remediation.md and 14-PLUGIN-BRIDGE-MATRIX.md.
            message: err instanceof Error ? err.message : String(err),
          }),
        )
        .finally(() => this.inflight.delete(id));
    }
  };

  private replyRpc(
    id: string,
    ok: boolean,
    payload?: unknown,
    error?: { code?: string; message?: string },
  ): void {
    if (this.disposed) return;
    const msg: HostToPlugin = { type: 'host:rpc-response', id, ok, payload, error };
    try {
      this.opts.target.postMessage(msg, this.targetOrigin);
    } catch {
      // A peer may disappear or a returned payload may not be cloneable. Never leave an unhandled rejection.
      if (ok) {
        try {
          this.opts.target.postMessage(
            {
              type: 'host:rpc-response',
              id,
              ok: false,
              error: { code: 'rpc-failed', message: 'RPC response could not be delivered' },
            },
            this.targetOrigin,
          );
        } catch {
          /* peer is gone */
        }
      }
    }
  }

  /**
   * The plugin's advertised bridge protocol version, or null before
   * plugin:ready. A plugin that predates versioning omits it and reports as 1.
   */
  get pluginProtocolVersion(): number | null {
    return this._pluginProtocolVersion;
  }

  sendHelloOnReady(payload: Omit<Extract<HostToPlugin, { type: 'host:hello' }>, 'type'>): void {
    this.assertActive();
    if (
      !theme(payload.theme) ||
      !tokens(payload.tokens) ||
      typeof payload.gatewayUrl !== 'string' ||
      typeof payload.authToken !== 'string' ||
      !version1(payload) ||
      (payload.locale !== undefined && !locale(payload.locale))
    )
      throw new Error('invalid host hello');
    this.pendingHelloPayload = payload;
    this.flushHello();
  }

  private flushHello(): void {
    if (!this.pluginReady || !this.pendingHelloPayload) return;
    // Advertise the host's bridge protocol version unless the caller already
    // set one explicitly in the payload.
    const msg: HostToPlugin = {
      type: 'host:hello',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      ...this.pendingHelloPayload,
    };
    this.opts.target.postMessage(msg, this.targetOrigin);
    this.helloSent = true;
  }

  sendThemeChange(payload: { theme: Theme; tokens: Record<string, string> }): void {
    this.assertActive();
    if (!theme(payload.theme) || !tokens(payload.tokens)) throw new Error('invalid theme');
    this.pendingThemePayload = payload;
    this.flushTheme();
  }

  private flushTheme(): void {
    if (!this.pluginReady || !this.pendingThemePayload) return;
    const msg: HostToPlugin = { type: 'host:theme-change', ...this.pendingThemePayload };
    this.opts.target.postMessage(msg, this.targetOrigin);
    this.pendingThemePayload = null;
  }

  sendLocaleChange(locale: Locale): void {
    this.assertActive();
    if (locale !== 'en' && locale !== 'es') throw new Error('invalid locale');
    this.pendingLocalePayload = { locale };
    this.flushLocale();
  }

  private flushLocale(): void {
    if (!this.pluginReady || !this.pendingLocalePayload) return;
    const msg: HostToPlugin = { type: 'host:locale-change', ...this.pendingLocalePayload };
    this.opts.target.postMessage(msg, this.targetOrigin);
    this.pendingLocalePayload = null;
  }

  onResize(fn: (height: number) => void): void {
    this.assertActive();
    this.resizeHandlers.push(fn);
  }

  onNotify(fn: (level: 'info' | 'warn' | 'error', message: string) => void): void {
    this.assertActive();
    this.notifyHandlers.push(fn);
  }

  onPluginReady(fn: () => void): void {
    this.assertActive();
    if (this.pluginReady) fn();
    else this.readyHandlers.push(fn);
  }

  onDirtyChanged(fn: (dirty: boolean) => void): void {
    this.assertActive();
    this.dirtyHandlers.push(fn);
  }

  onSaveResult(
    fn: (id: string, ok: boolean, error?: string, restartRequired?: boolean) => void,
  ): void {
    this.assertActive();
    this.saveResultHandlers.push(fn);
  }

  /**
   * Trigger the plugin's save flow. Returns the request id; pair with
   * onSaveResult to observe completion.
   */
  requestSave(): string {
    this.assertActive();
    if (!this.pluginReady || !this.helloSent) throw new Error('bridge handshake incomplete');
    const id = `save-${++this.saveSeq}-${Date.now()}`;
    const msg: HostToPlugin = { type: 'host:save', id };
    this.saves.add(id);
    try {
      this.opts.target.postMessage(msg, this.targetOrigin);
    } catch (error) {
      this.saves.delete(id);
      throw error;
    }
    return id;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('bridge disposed');
    if (!this.opts.sandboxed && !exactOrigin(this.opts.pluginOrigin))
      throw new Error('bridge requires an exact plugin origin');
  }

  dispose(): void {
    this.disposed = true;
    this.pluginReady = false;
    this.helloSent = false;
    this._pluginProtocolVersion = null;
    this.inflight.clear();
    this.saves.clear();
    this.pendingLocalePayload = null;
    this.opts.self.removeEventListener('message', this.handle);
    this.pendingHelloPayload = null;
    this.pendingThemePayload = null;
    this.resizeHandlers = [];
    this.notifyHandlers = [];
    this.readyHandlers = [];
    this.dirtyHandlers = [];
    this.saveResultHandlers = [];
  }
}
