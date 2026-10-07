import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayClient as SharedClient, HelloOk } from '@minion-stack/shared';
import type { Host } from '$lib/types/host';

const harness = vi.hoisted(() => ({
  clients: [] as Array<{
    options: ConstructorParameters<typeof SharedClient>[0];
    request: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    resolve: (hello: HelloOk) => void;
  }>,
  hosts: {
    activeHostId: 'a',
    hosts: [
      { id: 'a', name: 'A', url: 'wss://a.invalid', lastConnectedAt: null },
      { id: 'b', name: 'B', url: 'wss://b.invalid', lastConnectedAt: null },
    ] as Host[],
  },
  user: { user: { id: 'actor' }, orgId: 'org' },
}));
vi.mock('@minion-stack/shared', async (original) => ({
  ...(await original<typeof import('@minion-stack/shared')>()),
  GatewayClient: class {
    readonly request = vi.fn(async () => ({}));
    readonly close = vi.fn();
    readonly options;
    resolve!: (hello: HelloOk) => void;
    constructor(options: ConstructorParameters<typeof SharedClient>[0]) {
      this.options = options;
      harness.clients.push(this);
    }
    setParentTraceparent() {}
    connect() {
      return new Promise<HelloOk>((resolve) => {
        this.resolve = resolve;
      });
    }
    getSocket() {
      return null;
    }
  },
}));
vi.mock('$lib/state/features/hosts.svelte', () => ({
  hostsState: harness.hosts,
  getActiveHost: () => harness.hosts.hosts.find((host) => host.id === harness.hosts.activeHostId),
  fetchHostToken: vi.fn(async () => 'disposable-token'),
  updateHost: vi.fn(async () => {}),
  saveLastActiveHost: vi.fn(),
  getOrgAssignedHost: vi.fn(),
  revalidateChannel: vi.fn(async () => null),
}));
vi.mock('$lib/state/features/user.svelte', () => ({ userState: harness.user }));
vi.mock('$lib/state/workshop/workshop.svelte', () => ({
  autoSave: vi.fn(),
  resetWorkshop: vi.fn(),
}));
vi.mock('$lib/query/client', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('$lib/state/features/agent-groups.svelte', () => ({ loadAgentGroups: vi.fn() }));
vi.mock('$lib/assistant/dispatch', () => ({ runAssistantUiCalls: vi.fn() }));
vi.mock('$lib/state/config/config.svelte', () => ({
  configState: { loaded: false },
  loadConfig: vi.fn(),
}));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

import { wsConnect, wsDisconnect, cutoverToHost } from './gateway.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { gw } from '$lib/state/gateway/gateway-data.svelte';
import { getClient } from './gateway-rpc';
const settle = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
function hello(version: string): HelloOk {
  return {
    type: 'hello-ok',
    protocol: 3,
    server: { version, connId: 'fixture-' + version },
    features: { methods: [], events: [] },
    snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 0 },
    policy: { maxPayload: 100000, maxBufferedBytes: 100000, tickIntervalMs: 30000 },
  };
}
function authenticate(index: number, version: string) {
  const client = harness.clients[index];
  const payload = hello(version);
  client.options.onAuthenticated?.(payload, { generation: 1 });
  client.resolve(payload);
  return client;
}
beforeEach(() => {
  vi.useFakeTimers();
  harness.hosts.activeHostId = 'a';
  harness.user.user.id = 'actor';
  harness.user.orgId = 'org';
  harness.clients.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"flows":[],"servers":[]}')),
  );
});
afterEach(() => {
  wsDisconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('real Hub gateway facade session hook', () => {
  it('publishes initial and automatic reconnect exactly once and reloads bootstrap data', async () => {
    await wsConnect();
    const client = authenticate(0, 'one');
    await settle();
    expect(conn.connected).toBe(true);
    expect(client.request.mock.calls.filter(([method]) => method === 'agents.list')).toHaveLength(
      1,
    );
    client.options.onClose?.(1006, 'lost');
    expect(conn.connected).toBe(false);
    conn.connectError = 'previous failure';
    client.options.onAuthenticated?.(hello('two'), { generation: 2 });
    await settle();
    expect(conn.connected).toBe(true);
    expect(conn.connectError).toBeNull();
    expect(gw.hello?.server.version).toBe('two');
    expect(client.request.mock.calls.filter(([method]) => method === 'agents.list')).toHaveLength(
      2,
    );
    await vi.advanceTimersByTimeAsync(33_000);
    expect(client.request.mock.calls.filter(([method]) => method === 'agents.list')).toHaveLength(
      3,
    );
  });

  it('ignores old client close, events and pending reads after a new host connects', async () => {
    await wsConnect();
    const old = harness.clients[0];
    const pending: Array<(value: unknown) => void> = [];
    old.request.mockImplementation(
      () =>
        new Promise((done) => {
          pending.push(done);
        }),
    );
    authenticate(0, 'old');
    harness.hosts.activeHostId = 'b';
    await wsConnect();
    authenticate(1, 'new');
    await settle();
    old.options.onClose?.(1006, 'old socket');
    old.options.onEvent?.({ type: 'event', event: 'health', payload: { stale: true } });
    expect(pending).toHaveLength(6);
    for (const resolve of pending)
      resolve({
        stale: true,
        jobs: [{ id: 'old' }],
        agents: [{ id: 'old' }],
        sessions: [{ key: 'agent:old:main' }],
      });
    await settle();
    expect(conn.connected).toBe(true);
    expect(gw.hello?.server.version).toBe('new');
    expect(gw.health).toEqual({});
    expect(gw.cronJobs).toEqual([]);
    expect(gw.agents).toEqual([]);
    expect(gw.sessions).toEqual([]);
  });

  it('does not promote a backup that closed after its connect promise resolved', async () => {
    await wsConnect();
    authenticate(0, 'source');
    const cutover = cutoverToHost(harness.hosts.hosts[1]);
    await settle();
    const backup = authenticate(1, 'backup');
    backup.options.onClose?.(1006, 'lost before promotion');
    expect(await cutover).toBe(false);
    expect(getClient()).toBe(harness.clients[0]);
    expect(gw.hello?.server.version).toBe('source');
  });

  it('promotes a live backup through the same single publication path', async () => {
    await wsConnect();
    authenticate(0, 'source');
    const cutover = cutoverToHost(harness.hosts.hosts[1]);
    await settle();
    const backup = authenticate(1, 'backup');
    expect(backup.request).not.toHaveBeenCalled();
    expect(await cutover).toBe(true);
    await settle();
    expect(harness.hosts.activeHostId).toBe('b');
    expect(gw.hello?.server.version).toBe('backup');
    expect(backup.request.mock.calls.filter(([method]) => method === 'agents.list')).toHaveLength(
      1,
    );
    harness.clients[0].options.onClose?.(1006, 'old');
    expect(conn.connected).toBe(true);
  });

  it('retires a handshake when its actor changes even within the same organization', async () => {
    await wsConnect();
    harness.user.user.id = 'another-actor';
    authenticate(0, 'stale');
    await settle();
    expect(conn.connected).toBe(false);
    expect(harness.clients[0].request).not.toHaveBeenCalled();
    expect(gw.hello).toBeNull();
  });

  it('re-fetches the org-scoped channel snapshot on the payload-less changed signal', async () => {
    // GW-027: tenant sessions no longer receive the platform-wide channels.status
    // push; the gateway sends channels.status.changed and the RPC supplies the rows.
    // (Node environment: the window signal is guarded in the facade and not asserted here.)
    await wsConnect();
    const client = authenticate(0, 'one');
    await settle();
    const snapshot = { channels: [{ id: 'whatsapp', accounts: [{ accountId: 'org-only' }] }] };
    client.request.mockImplementation(async (method: string) =>
      method === 'channels.status' ? snapshot : {},
    );
    const before = client.request.mock.calls.filter(([m]) => m === 'channels.status').length;
    client.options.onEvent?.({
      type: 'event',
      event: 'channels.status.changed',
      payload: { changedAt: 1 },
    });
    await settle();
    expect(client.request.mock.calls.filter(([m]) => m === 'channels.status')).toHaveLength(
      before + 1,
    );
    expect(gw.channels).toEqual(snapshot);
  });

  it('disconnects before the delayed poll can start', async () => {
    await wsConnect();
    const client = authenticate(0, 'live');
    await settle();
    const count = client.request.mock.calls.length;
    wsDisconnect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.request).toHaveBeenCalledTimes(count);
    expect(conn.connected).toBe(false);
  });
});
