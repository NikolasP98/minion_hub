/**
 * Spec 045 A3 (T030–T033): the dashboard's gateway credential.
 *
 * Flag unset (or anything but 'false'): today's connect frame, byte for byte.
 * `PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN === 'false'`: the browser carries only a
 * per-gateway JWT, renews it on the socket, and never falls back to the token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayClient as SharedClient, HelloOk } from '@minion-stack/shared';
import type { Host } from '$lib/types/host';
import { env as publicEnv } from '$env/dynamic/public';

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
import { fetchHostToken } from '$lib/state/features/hosts.svelte';
import { toastError } from '$lib/state/ui/toast.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
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

/** Every `/api/gateway/jwt` request, and what the route answers next. */
let jwtCalls: string[] = [];
let jwtReplies: Array<{ status: number; token?: string }> = [];
let minted = 0;
function routeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.startsWith('/api/gateway/jwt')) {
    jwtCalls.push(url);
    const reply = jwtReplies.shift() ?? { status: 200, token: `jwt-${++minted}` };
    return Promise.resolve(
      reply.status === 200
        ? new Response(JSON.stringify({ token: reply.token, expiresAt: 0 }))
        : new Response(JSON.stringify({ error: 'x' }), { status: reply.status }),
    );
  }
  return Promise.resolve(new Response('{"flows":[],"servers":[]}'));
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.hosts.activeHostId = 'a';
  harness.user.user.id = 'actor';
  harness.user.orgId = 'org';
  harness.clients.length = 0;
  jwtCalls = [];
  jwtReplies = [];
  minted = 0;
  vi.mocked(fetchHostToken).mockClear();
  vi.mocked(toastError).mockClear();
  vi.stubGlobal('fetch', vi.fn(routeFetch));
  vi.stubGlobal('navigator', { userAgent: 'fixture-agent', language: 'es-PE' });
});
afterEach(() => {
  wsDisconnect();
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  delete publicEnv.PUBLIC_GATEWAY_JWT_AUTH;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('flag unset: today’s connect frame', () => {
  // Recorded from the pre-A3 client (a1893ad5) — any byte change here is a launch-blocking regression.
  const TOKEN_ONLY =
    '{"minProtocol":3,"maxProtocol":3,"client":{"id":"minion-control-ui","version":"1.0","platform":"web","mode":"ui"},"role":"operator","scopes":["operator.admin","operator.read","operator.write","operator.approvals","operator.pairing"],"caps":["tool-events"],"auth":{"token":"disposable-token"},"userId":"actor","userAgent":"fixture-agent","locale":"es-PE"}';
  const TOKEN_AND_JWT =
    '{"minProtocol":3,"maxProtocol":3,"client":{"id":"minion-control-ui","version":"1.0","platform":"web","mode":"ui"},"role":"operator","scopes":["operator.admin","operator.read","operator.write","operator.approvals","operator.pairing"],"caps":["tool-events"],"auth":{"token":"disposable-token"},"jwt":"jwt-1","userId":"actor","userAgent":"fixture-agent","locale":"es-PE"}';

  it('sends the shared token alone', async () => {
    await wsConnect();
    const frame = await harness.clients[0].options.onChallenge('nonce');
    expect(JSON.stringify(frame)).toBe(TOKEN_ONLY);
    expect(jwtCalls).toEqual([]);
  });

  it('sends the shared token with the audience-less JWT', async () => {
    publicEnv.PUBLIC_GATEWAY_JWT_AUTH = 'true';
    await wsConnect();
    const frame = await harness.clients[0].options.onChallenge('nonce');
    expect(JSON.stringify(frame)).toBe(TOKEN_AND_JWT);
    expect(jwtCalls).toEqual(['/api/gateway/jwt']);
  });

  it('keeps today’s client for any value but "false"', async () => {
    publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'no';
    await wsConnect();
    const frame = await harness.clients[0].options.onChallenge('nonce');
    expect(JSON.stringify(frame)).toBe(TOKEN_ONLY);
    expect(fetchHostToken).toHaveBeenCalledWith('a');
  });
});

describe("flag 'false': per-gateway JWT only", () => {
  beforeEach(() => {
    // Stray case and whitespace still switch (a pasted Vercel value).
    publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = ' False\n';
  });
  const refreshes = (index: number) =>
    harness.clients[index].request.mock.calls.filter(([method]) => method === 'auth.refresh');

  it('connects with a JWT for this gateway and never asks for the shared token', async () => {
    await wsConnect();
    const frame = await harness.clients[0].options.onChallenge('nonce');
    expect(JSON.stringify(frame)).not.toContain('"auth"');
    expect(frame.jwt).toBe('jwt-1');
    expect(jwtCalls).toEqual(['/api/gateway/jwt?gatewayId=a']);
    expect(fetchHostToken).not.toHaveBeenCalled();
  });

  it('says the role cannot connect when issuance answers 403, and builds no socket', async () => {
    jwtReplies = [{ status: 403 }];
    await wsConnect();
    await vi.dynamicImportSettled();
    expect(harness.clients).toHaveLength(0);
    expect(conn.connecting).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toastError).mock.calls[0][0])).toMatch(/role can't connect/i);
  }, 30_000); // first lazy messages-chunk load

  it.each([500, 503])('shows the existing unreachable state on an issuance %i', async (status) => {
    jwtReplies = [{ status }];
    await wsConnect();
    expect(harness.clients).toHaveLength(0);
    expect(conn.connected).toBe(false);
    expect(vi.mocked(toastError).mock.calls[0][2]).toEqual({ id: 'gateway-token-unavailable' });
  });

  it('never falls back to the shared token when the gateway rejects the JWT', async () => {
    publicEnv.PUBLIC_GATEWAY_JWT_AUTH = 'true';
    await wsConnect();
    const client = authenticate(0, 'one');
    await settle();
    client.options.onClose?.(1008, 'jwt_validation_failed');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(harness.clients).toHaveLength(1);
    expect(client.close).not.toHaveBeenCalled();
    expect(fetchHostToken).not.toHaveBeenCalled();
  });

  it('never presents a JWT minted for one gateway to another', async () => {
    await wsConnect(); // prefetches jwt-1 for gateway a; its challenge never runs
    authenticate(0, 'a');
    await settle();
    const cutover = cutoverToHost(harness.hosts.hosts[1]);
    await settle();
    const frame = await harness.clients[1].options.onChallenge('nonce');
    expect(frame.jwt).toBe('jwt-2');
    expect(jwtCalls).toEqual(['/api/gateway/jwt?gatewayId=a', '/api/gateway/jwt?gatewayId=b']);
    authenticate(1, 'b');
    expect(await cutover).toBe(true);
    expect(fetchHostToken).not.toHaveBeenCalled();
  });

  it('re-mints a prefetched JWT older than five minutes', async () => {
    await wsConnect();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const frame = await harness.clients[0].options.onChallenge('nonce');
    expect(frame.jwt).toBe('jwt-2');
    expect(jwtCalls).toHaveLength(2);
  });

  it('renews the JWT on the socket every 600 s', async () => {
    await wsConnect();
    await harness.clients[0].options.onChallenge('nonce');
    authenticate(0, 'one');
    await settle();
    await vi.advanceTimersByTimeAsync(599_000);
    expect(refreshes(0)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshes(0)).toEqual([['auth.refresh', { jwt: 'jwt-2' }]]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refreshes(0)).toEqual([
      ['auth.refresh', { jwt: 'jwt-2' }],
      ['auth.refresh', { jwt: 'jwt-3' }],
    ]);
    expect(jwtCalls.every((url) => url === '/api/gateway/jwt?gatewayId=a')).toBe(true);
  });

  it('ignores a failed renewal; the socket keeps its JWT until the gateway closes it', async () => {
    await wsConnect();
    authenticate(0, 'one');
    await settle();
    jwtReplies = [{ status: 503 }];
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refreshes(0)).toHaveLength(0);
    expect(harness.clients[0].close).not.toHaveBeenCalled();
  });

  it('stops renewing once the socket closes', async () => {
    await wsConnect();
    const client = authenticate(0, 'one');
    await settle();
    client.options.onClose?.(1006, 'lost');
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(refreshes(0)).toHaveLength(0);
  });

  it('moves renewal to the new socket on cutover, with that gateway’s JWT', async () => {
    await wsConnect();
    authenticate(0, 'a');
    await settle();
    const cutover = cutoverToHost(harness.hosts.hosts[1]);
    await settle();
    authenticate(1, 'b');
    expect(await cutover).toBe(true);
    jwtCalls = [];
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refreshes(0)).toHaveLength(0);
    expect(refreshes(1)).toHaveLength(1);
    expect(jwtCalls).toEqual(['/api/gateway/jwt?gatewayId=b']);
  });

  it('reconnects after a 4401 jwt_expired close with a fresh JWT, through one client', async () => {
    await wsConnect();
    const client = authenticate(0, 'one');
    await harness.clients[0].options.onChallenge('nonce'); // consumes jwt-1
    await settle();
    client.options.onClose?.(4401, 'jwt_expired');
    // GatewayClient's own autoReconnect re-runs the challenge on the same client.
    const frame = await client.options.onChallenge('nonce-2');
    expect(frame.jwt).toBe('jwt-2');
    expect(harness.clients).toHaveLength(1);
    expect(client.close).not.toHaveBeenCalled();
    expect(fetchHostToken).not.toHaveBeenCalled();
  });

  it('stops reconnecting and says so when a reconnect is refused for the role', async () => {
    await wsConnect();
    const client = authenticate(0, 'one');
    await client.options.onChallenge('nonce'); // consumes jwt-1
    await settle();
    client.options.onClose?.(4401, 'jwt_expired');
    jwtReplies = [{ status: 403 }];
    await expect(client.options.onChallenge('nonce-2')).rejects.toThrow();
    await vi.dynamicImportSettled();
    expect(client.close).toHaveBeenCalled();
    expect(getClient()).toBeNull();
    expect(String(vi.mocked(toastError).mock.calls.at(-1)?.[0])).toMatch(/role can't connect/i);
  }, 30_000); // first lazy messages-chunk load
});

describe('flag unset: no renewal on token sockets', () => {
  it('never sends auth.refresh (pre-A1 gateways broadcast it to every socket)', async () => {
    publicEnv.PUBLIC_GATEWAY_JWT_AUTH = 'true';
    await wsConnect();
    const client = authenticate(0, 'one');
    await settle();
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(client.request.mock.calls.filter(([m]) => m === 'auth.refresh')).toHaveLength(0);
  });
});
