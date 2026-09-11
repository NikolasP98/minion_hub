import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PluginBridge as InstalledPlugin } from '@nikolasp98/plugin-ui-bridge';
import { HostBridge } from './bridge-protocol';

// The candidate package lives in the sibling gateway checkout (minion/packages/plugin-ui-bridge).
// Hub CI checks out Hub alone, so the source/built candidate comparisons run only where that
// checkout exists (or are forced off with HUB_SKIP_SIBLING_BRIDGE=1); the installed 0.4.0
// baseline is always available through node_modules.
type PluginCtor = typeof InstalledPlugin;
const siblingRoot = new URL('../../../../minion/packages/plugin-ui-bridge/', import.meta.url);
const siblingFile = (rel: string) => fileURLToPath(new URL(rel, siblingRoot));
const siblingPresent =
  !process.env.HUB_SKIP_SIBLING_BRIDGE &&
  existsSync(siblingFile('src/index.ts')) &&
  existsSync(siblingFile('dist/index.js'));
const siblingSource = siblingPresent
  ? ((await import(/* @vite-ignore */ siblingFile('src/index.ts'))) as {
      PluginBridge: PluginCtor;
      HostBridge: typeof HostBridge;
    })
  : undefined;
const siblingBuilt = siblingPresent
  ? ((await import(/* @vite-ignore */ siblingFile('dist/index.js'))) as {
      PluginBridge: PluginCtor;
    })
  : undefined;
const CandidatePlugin: PluginCtor = siblingSource?.PluginBridge ?? InstalledPlugin;
const BuiltPlugin: PluginCtor = siblingBuilt?.PluginBridge ?? InstalledPlugin;
const PackageHost: typeof HostBridge = siblingSource?.HostBridge ?? HostBridge;

const HOST = 'https://hub.example';
const PLUGIN = 'https://plugin.example';
const hello = { theme: 'dark' as const, tokens: {}, gatewayUrl: '', authToken: '' };
class Peer {
  listeners = new Set<(event: MessageEvent) => void>();
  posted: unknown[] = [];
  other!: Peer;
  constructor(readonly origin: string) {}
  addEventListener(_type: string, callback: (event: MessageEvent) => void) {
    this.listeners.add(callback);
  }
  removeEventListener(_type: string, callback: (event: MessageEvent) => void) {
    this.listeners.delete(callback);
  }
  postMessage(data: unknown, target: string) {
    const cloned = structuredClone(data);
    this.posted.push(cloned);
    if (target !== '*' && target !== this.origin) return;
    queueMicrotask(() => this.emit(cloned, this.other.origin, this.other));
  }
  emit(data: unknown, origin = this.other.origin, source: Peer = this.other) {
    for (const callback of this.listeners)
      callback({ data, origin, source } as unknown as MessageEvent);
  }
  get window() {
    return this as unknown as Window;
  }
}
const drain = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function pair(Plugin: PluginCtor = CandidatePlugin, opaque = false) {
  const parent = new Peer(HOST),
    child = new Peer(opaque ? 'null' : PLUGIN);
  parent.other = child;
  child.other = parent;
  const forward = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
    async (method, params) => ({ method, params }),
  );
  const host = new HostBridge({
    self: parent.window,
    target: child.window,
    pluginOrigin: PLUGIN,
    sandboxed: opaque,
    forwardRpc: forward,
  });
  const plugin = new Plugin({
    self: child.window,
    parent: parent.window,
    expectedHostOrigin: HOST,
  });
  return { parent, child, host, plugin, forward };
}

describe.skipIf(!siblingPresent)('actual host/plugin boundary', () => {
  it.each([
    ['source', CandidatePlugin],
    ['built candidate', BuiltPlugin],
  ] as const)(
    '%s keeps a late response from an old bridge lifetime out of its same-window successor',
    async (_label, Plugin) => {
      vi.spyOn(Date, 'now').mockReturnValue(123456);
      let namespace = 0;
      vi.stubGlobal('crypto', {
        getRandomValues(bytes: Uint8Array) {
          bytes.fill(++namespace);
          return bytes;
        },
      });
      const { parent, child, host, plugin: first, forward } = pair(Plugin, true);
      const replies: Array<(value: unknown) => void> = [];
      forward.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
      let successor: InstanceType<PluginCtor> | undefined;
      try {
        host.sendHelloOnReady(hello);
        first.notifyReady();
        await drain();
        const oldCall = first.call('hub.artifact.context.get');
        const oldRejection = expect(oldCall).rejects.toThrow('disposed');
        await drain();
        first.dispose();
        await oldRejection;
        successor = new Plugin({
          self: child.window,
          parent: parent.window,
          expectedHostOrigin: HOST,
        });
        successor.notifyReady();
        await drain();
        const newCall = successor.call('hub.artifact.context.get');
        const settled = vi.fn();
        void newCall.then(settled, settled);
        await drain();
        replies[0]!({ lifetime: 'old' });
        await drain();
        expect(settled).not.toHaveBeenCalled();
        expect(forward).toHaveBeenCalledTimes(2);
        replies[1]!({ lifetime: 'new' });
        await expect(newCall).resolves.toEqual({ lifetime: 'new' });
        expect(namespace).toBe(2);
      } finally {
        first.dispose();
        successor?.dispose();
        host.dispose();
        for (const reply of replies) reply(undefined);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    },
  );
  for (const [label, Plugin] of [
    ['candidate source', CandidatePlugin],
    ['installed 0.4.0 baseline', InstalledPlugin],
    ['locally built candidate', BuiltPlugin],
  ] as const) {
    for (const opaque of [false, true]) {
      for (const readyFirst of [false, true]) {
        it(`${label}: ${opaque ? 'opaque' : 'ordinary'} peers, ready first=${readyFirst}`, async () => {
          const { host, plugin, forward } = pair(Plugin, opaque);
          const themes = vi.fn(),
            locales = vi.fn();
          plugin.onThemeChange(themes);
          plugin.onLocaleChange(locales);
          host.sendThemeChange({ theme: 'light', tokens: {} });
          host.sendThemeChange({ theme: 'dark', tokens: {} });
          host.sendLocaleChange('en');
          host.sendLocaleChange('es');
          if (readyFirst) {
            plugin.notifyReady();
            await drain();
            host.sendHelloOnReady(hello);
          } else {
            host.sendHelloOnReady(hello);
            plugin.notifyReady();
          }
          await drain();
          expect(plugin.hostProtocolVersion).toBe(1);
          const result = plugin.call('plugins.config.get', { pluginId: 'fixture' });
          await drain();
          await expect(result).resolves.toEqual({
            method: 'plugins.config.get',
            params: { pluginId: 'fixture' },
          });
          expect(forward).toHaveBeenCalledOnce();
          expect(themes).toHaveBeenCalledWith({
            type: 'host:theme-change',
            theme: 'dark',
            tokens: {},
          });
          expect(locales).toHaveBeenCalledWith({ type: 'host:locale-change', locale: 'es' });
          const saved = vi.fn();
          host.onSaveResult(saved);
          plugin.onSaveRequest((id) => plugin.notifySaveResult(id, true));
          const id = host.requestSave();
          await drain();
          expect(saved).toHaveBeenCalledWith(id, true, undefined, undefined);
          plugin.dispose();
          host.dispose();
        });
      }
    }
  }

  it('denies wrong source, wrong origin, pre-handshake and malformed RPC', async () => {
    const { parent, child, host, forward } = pair();
    host.sendHelloOnReady(hello);
    const request = { type: 'plugin:rpc-request', id: 'x', method: 'privileged' };
    parent.emit(request);
    parent.emit({ type: 'plugin:ready' }, PLUGIN, new Peer(PLUGIN));
    parent.emit(request, PLUGIN, new Peer(PLUGIN));
    parent.emit({ type: 'plugin:ready' }, 'https://wrong.example');
    for (const version of [null, undefined, '1', 2, NaN, Infinity])
      parent.emit({ type: 'plugin:ready', protocolVersion: version });
    parent.emit(request);
    await drain();
    expect(forward).not.toHaveBeenCalled();
    parent.emit({ type: 'plugin:ready' });
    await drain();
    for (const data of [
      null,
      [],
      { type: 'unknown' },
      { ...request, id: 1 },
      { ...request, id: '' },
      { ...request, method: [] },
      { ...request, method: '' },
    ])
      parent.emit(data);
    parent.emit(request, 'https://wrong.example');
    parent.emit(request, PLUGIN, new Peer(PLUGIN));
    await drain();
    expect(forward).not.toHaveBeenCalled();
    expect(child.posted.filter((m) => (m as { type: string }).type === 'host:hello')).toHaveLength(
      1,
    );
    host.dispose();
  });

  it('opaque host requires both null origin and exact window', async () => {
    const { parent, host, forward } = pair(CandidatePlugin, true);
    host.sendHelloOnReady(hello);
    parent.emit({ type: 'plugin:ready' }, PLUGIN);
    parent.emit({ type: 'plugin:ready' }, 'null', new Peer('null'));
    parent.emit({ type: 'plugin:rpc-request', id: 'x', method: 'privileged' });
    await drain();
    expect(forward).not.toHaveBeenCalled();
    host.dispose();
  });

  it('drops late forwarding completion and work after disposal', async () => {
    const { host, plugin, forward, child } = pair();
    let release!: (value: unknown) => void;
    forward.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    host.sendHelloOnReady(hello);
    plugin.notifyReady();
    await drain();
    const pending = plugin.call('pending');
    const rejection = expect(pending).rejects.toThrow('disposed');
    await drain();
    const before = child.posted.length;
    host.dispose();
    plugin.dispose();
    release({ late: true });
    await drain();
    await rejection;
    expect(child.posted).toHaveLength(before);
    await expect(plugin.call('late')).rejects.toThrow('disposed');
    expect(() => host.requestSave()).toThrow('disposed');
  });

  it('correlates forwarder failure and suppresses duplicate in-flight ids', async () => {
    const { host, plugin, forward, parent } = pair();
    forward.mockRejectedValue(new Error('synthetic failure'));
    host.sendHelloOnReady(hello);
    plugin.notifyReady();
    await drain();
    const pending = plugin.call('fail');
    const rejected = expect(pending).rejects.toThrow('synthetic failure');
    parent.emit(parent.posted.at(-1));
    await drain();
    await rejected;
    expect(forward).toHaveBeenCalledOnce();
    plugin.dispose();
    host.dispose();
  });

  it('package legacy host also rejects same-origin wrong windows', () => {
    const parent = new Peer(HOST),
      child = new Peer(PLUGIN);
    parent.other = child;
    child.other = parent;
    const host = new PackageHost({
      self: parent.window,
      target: child.window,
      pluginOrigin: PLUGIN,
    });
    host.sendHelloOnReady(hello);
    parent.emit({ type: 'plugin:ready' }, PLUGIN, new Peer(PLUGIN));
    expect(child.posted).toHaveLength(0);
    host.dispose();
  });
  it('validates every plugin frame and save correlation before callbacks', async () => {
    const { host, parent, plugin } = pair();
    const resize = vi.fn(),
      notify = vi.fn(),
      dirty = vi.fn(),
      saved = vi.fn();
    host.onResize(resize);
    host.onNotify(notify);
    host.onDirtyChanged(dirty);
    host.onSaveResult(saved);
    for (const data of [
      { type: 'plugin:resize', height: NaN },
      { type: 'plugin:resize', height: -1 },
      { type: 'plugin:resize', height: '4' },
      { type: 'plugin:notify', level: 'bad', message: 'x' },
      { type: 'plugin:notify', level: 'warn', message: null },
      { type: 'plugin:dirty-changed', dirty: 1 },
      { type: 'plugin:save-result', id: 'x', ok: 'true' },
    ])
      parent.emit(data);
    expect(resize).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    host.sendHelloOnReady(hello);
    plugin.notifyReady();
    await drain();
    const id = host.requestSave();
    for (const data of [
      { type: 'plugin:save-result', id, ok: true, error: {} },
      { type: 'plugin:save-result', id, ok: true, restartRequired: 1 },
      { type: 'plugin:save-result', id: 'unsolicited', ok: true },
    ])
      parent.emit(data);
    expect(saved).not.toHaveBeenCalled();
    parent.emit({ type: 'plugin:save-result', id, ok: true });
    parent.emit({ type: 'plugin:save-result', id, ok: true });
    expect(saved).toHaveBeenCalledOnce();
    plugin.dispose();
    host.dispose();
  });

  it('requires hello as well as ready before forwarding', async () => {
    const { parent, host, forward } = pair();
    parent.emit({ type: 'plugin:ready' });
    parent.emit({ type: 'plugin:rpc-request', id: 'early', method: 'privileged' });
    await drain();
    expect(forward).not.toHaveBeenCalled();
    host.dispose();
  });

  it('returns a correlated error if the forward result cannot be cloned', async () => {
    const { host, plugin, forward } = pair();
    forward.mockResolvedValue(() => undefined);
    host.sendHelloOnReady(hello);
    plugin.notifyReady();
    await drain();
    const request = plugin.call('uncloneable');
    const rejected = expect(request).rejects.toThrow('could not be delivered');
    await drain();
    await rejected;
    plugin.dispose();
    host.dispose();
  });
  it('freezes the separate installed baseline bytes and records its known origin gap', () => {
    const entry = readFileSync(
      new URL('../../../node_modules/@nikolasp98/plugin-ui-bridge/dist/index.js', import.meta.url),
    );
    expect(createHash('sha256').update(entry).digest('hex')).toBe(
      'd92bb9daff3f6e56205c41d6aa6e645ec1d2a47e82aa074329d5905dde728a5c',
    );
    const parent = new Peer(HOST),
      child = new Peer(PLUGIN);
    parent.other = child;
    child.other = parent;
    const baseline = new InstalledPlugin({
      self: child.window,
      parent: parent.window,
      expectedHostOrigin: HOST,
    });
    const candidate = new CandidatePlugin({
      self: child.window,
      parent: parent.window,
      expectedHostOrigin: HOST,
    });
    const oldHello = vi.fn(),
      newHello = vi.fn();
    baseline.onHello(oldHello);
    candidate.onHello(newHello);
    child.emit({ type: 'host:hello', ...hello }, HOST, new Peer(HOST));
    expect(oldHello).toHaveBeenCalledOnce();
    expect(newHello).not.toHaveBeenCalled();
    baseline.dispose();
    candidate.dispose();
  });
});
