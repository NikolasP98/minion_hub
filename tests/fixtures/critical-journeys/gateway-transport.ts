import type { Host } from '$lib/types/host';

const host: Host = {
  id: 'critical-host',
  name: 'Synthetic fixture gateway',
  url: 'ws://critical.invalid',
  lastConnectedAt: null,
};
export const page = {
  url: new URL('http://127.0.0.1:18903/home.html'),
  params: {},
  route: { id: '/(app)/home' },
  status: 200,
  error: null,
  form: null,
  state: {},
  data: {
    user: { id: 'fixture-user', role: 'admin', email: 'fixture@minion.test' },
    permissions: { permissions: ['scheduling:edit', 'scheduling:view'] },
    activeOrgKind: 'business',
    activeOrgId: 'fixture-org',
    orgAssignedHostId: host.id,
    hosts: { servers: [host], orgAssignedHostId: host.id, channels: [] },
    personalAgent: { agent: { agentId: 'fixture-agent', name: 'Fixture agent' } },
  },
};
export const navigating = null;
export const updated = { current: false, check: async () => false };
type Frame = { id: string; method: string; params?: Record<string, unknown> };
const requests: Frame[] = [];
const http: string[] = [];
const unexpected: string[] = [];
const history: unknown[] = [];
let heldConnect: (() => void) | undefined;
let heldTurn: (() => void) | undefined;
let conn: { connected: boolean } | undefined;
let disconnect: (() => void) | undefined;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

class FixtureSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readonly url: string;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    if (this.url !== host.url) throw new Error('Unexpected synthetic socket URL');
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      this.receive({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'fixture-nonce' },
      });
    });
  }
  receive(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
  send(data: string | ArrayBuffer) {
    if (typeof data !== 'string') {
      unexpected.push('binary dispatch');
      throw new Error('Unexpected binary dispatch');
    }
    const frame = JSON.parse(data) as Frame;
    requests.push(frame);
    const reply = (payload: unknown) =>
      queueMicrotask(() => this.receive({ type: 'res', id: frame.id, ok: true, payload }));
    if (frame.method === 'connect') {
      const complete = () =>
        reply({
          type: 'hello-ok',
          protocol: 3,
          server: { version: 'fixture', connId: 'fixture' },
          features: { methods: ['chat.send', 'chat.history'], events: ['chat'] },
          snapshot: { presence: [], health: {}, stateVersion: {}, uptimeMs: 0 },
          policy: { tickIntervalMs: 30000 },
        });
      if (new URLSearchParams(location.search).has('hold')) heldConnect = complete;
      else complete();
      return;
    }
    if (frame.method === 'chat.send') {
      reply({ runId: frame.params?.idempotencyKey, status: 'accepted' });
      heldTurn = () => {
        const message = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Synthetic response received.' }],
          timestamp: 1789084800000,
        };
        history.push(
          {
            role: 'user',
            content: [{ type: 'text', text: frame.params?.message }],
            timestamp: 1789084799000,
          },
          message,
        );
        this.receive({
          type: 'event',
          event: 'chat',
          payload: {
            sessionKey: frame.params?.sessionKey,
            runId: frame.params?.idempotencyKey,
            state: 'final',
            message,
          },
        });
      };
      return;
    }
    const responses: Record<string, unknown> = {
      'agents.list': { agents: [{ id: 'fixture-agent', name: 'Fixture agent' }] },
      'sessions.list': { sessions: [] },
      'chat.history': { messages: history },
      health: {},
      'system-presence': [],
      'channels.status': {},
      'cron.list': { jobs: [] },
      'myAgent.feedToday': {
        observations: [],
        calendarItems: [],
        emailItems: [],
        sinceMs: 1789084800000,
        total: 0,
      },
      'myAgent.memory.list': { memories: [] },
      'myAgent.notes.list': { notes: [] },
      'sessions.patch': {},
      'skills.status': { skills: [], agentFilter: null },
      'channels.plugins.list': { plugins: [] },
      'tools.status': { tools: [], groups: {}, profile: 'full', groupDescriptions: {} },
    };
    if (Object.hasOwn(responses, frame.method)) reply(responses[frame.method]);
    else {
      unexpected.push(`RPC ${frame.method}`);
      queueMicrotask(() =>
        this.receive({
          type: 'res',
          id: frame.id,
          ok: false,
          error: { code: 'FIXTURE_UNEXPECTED', message: 'Unexpected fixture method' },
        }),
      );
    }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }
}

export function install() {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FixtureSocket });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    http.push(`${method} ${url.pathname}`);
    if (url.origin !== location.origin) {
      unexpected.push('external fetch');
      throw new Error('External request denied');
    }
    if (url.pathname === '/api/servers/critical-host/token' && method === 'POST')
      return json({ token: 'synthetic-fixture-token' });
    if (url.pathname === '/api/servers/critical-host' && ['PUT', 'PATCH'].includes(method))
      return json({ server: host });
    if (url.pathname === '/api/servers' && method === 'GET') return json({ servers: [host] });
    if (url.pathname === '/api/flows' && method === 'GET') return json({ flows: [] });
    if (url.pathname === '/api/users/aliases' && method === 'GET') return json({ aliases: {} });
    if (url.pathname === '/api/notes' && method === 'GET') return json({ notes: [] });
    if (url.pathname === '/api/servers/critical-host/activity-bins' && method === 'GET')
      return json({ bins: [] });
    unexpected.push(`${method} ${url.pathname}`);
    throw new Error('Unregistered fixture HTTP request');
  };
  Object.assign(window, {
    __critical: {
      releaseHandshake: () => {
        heldConnect?.();
        heldConnect = undefined;
      },
      finishTurn: () => {
        heldTurn?.();
        heldTurn = undefined;
      },
      snapshot: () => ({ connected: conn?.connected ?? false, requests, http, unexpected }),
    },
  });
}

export async function begin() {
  const service = await import('$lib/services/gateway.svelte');
  (await import('$lib/state/features/hosts.svelte')).hostsState.activeHostId = host.id;
  conn = (await import('$lib/state/gateway')).conn;
  disconnect = service.wsDisconnect;
  await service.wsConnect();
}
export function stop() {
  disconnect?.();
}
