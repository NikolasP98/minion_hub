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
const histories = new Map<string, unknown[]>([['agent:fixture-agent:main', history]]);
function sessionHistory(key = 'agent:fixture-agent:main'): unknown[] {
  let messages = histories.get(key);
  if (!messages) {
    messages = [];
    histories.set(key, messages);
  }
  return messages;
}
let heldConnect: (() => void) | undefined;
let heldTurn: (() => void) | undefined;
let conn: { connected: boolean } | undefined;
let disconnect: (() => void) | undefined;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

export const fixtureBridge: {
  main?: (
    turn: { runId: string; sessionKey: string; message: string },
    socket: FixtureSocket,
    acknowledge: () => void,
    rejectAcknowledgement: () => void,
  ) => void;
  record: (turn: { message: string; sessionKey?: string }, message: unknown) => void;
  history: (sessionKey: string) => readonly unknown[];
  compact: (sessionKey?: string) => void;
  violation?: (kind: string) => void;
  socket?: FixtureSocket;
  historyGate?: (complete: () => void) => boolean;
} = {
  history: (sessionKey) => sessionHistory(sessionKey).slice(),
  record: (turn, message) => {
    sessionHistory(turn.sessionKey).push(
      { role: 'user', content: [{ type: 'text', text: turn.message }], timestamp: Date.now() - 1 },
      message,
    );
  },
  compact: (sessionKey) => {
    const history = sessionHistory(sessionKey);
    history.splice(0, Math.max(0, history.length - 2), {
      role: 'system',
      content: [{ type: 'text', text: 'Disposable server history compaction fixture.' }],
      timestamp: Date.now(),
    });
  },
};
export class FixtureSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readonly url: string;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  activeTurn: { runId: string; sessionKey: string; message: string } | null = null;
  readonly knownTurns = new Map<string, string>();
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    if (this.url !== host.url) {
      unexpected.push('external WebSocket');
      fixtureBridge.violation?.('external_websocket');
      throw new Error('Unexpected synthetic socket URL');
    }
    fixtureBridge.socket = this;
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
          features: { methods: ['chat.send', 'chat.history', 'chat.abort'], events: ['chat'] },
          snapshot: { presence: [], health: {}, stateVersion: {}, uptimeMs: 0 },
          policy: { tickIntervalMs: 30000 },
        });
      if (new URLSearchParams(location.search).has('hold')) heldConnect = complete;
      else complete();
      return;
    }
    if (frame.method === 'chat.send') {
      const runId = frame.params?.idempotencyKey;
      const sessionKey = frame.params?.sessionKey;
      const text = frame.params?.message;
      if (typeof runId !== 'string' || typeof sessionKey !== 'string' || typeof text !== 'string') {
        unexpected.push('invalid chat.send binding');
        return;
      }
      this.activeTurn = { runId, sessionKey, message: text };
      this.knownTurns.set(runId, sessionKey);
      if (this.knownTurns.size > 512) this.knownTurns.delete(this.knownTurns.keys().next().value!);
      if (fixtureBridge.main) {
        fixtureBridge.main(
          this.activeTurn,
          this,
          () => reply({ runId, status: 'accepted' }),
          () =>
            this.receive({
              type: 'res',
              id: frame.id,
              ok: false,
              error: {
                code: 'FIXTURE_ACK_UNKNOWN',
                message: 'Synthetic acknowledgement transport failure',
              },
            }),
        );
        return;
      }
      reply({ runId, status: 'accepted' });
      heldTurn = () => {
        if (this.activeTurn?.runId !== runId || this.activeTurn.sessionKey !== sessionKey) return;
        this.activeTurn = null;
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
    if (frame.method === 'chat.abort') {
      const turn = this.activeTurn;
      const matches =
        !!turn &&
        frame.params?.runId === turn.runId &&
        frame.params?.sessionKey === turn.sessionKey;
      reply({ ok: true, aborted: matches, runIds: matches ? [turn.runId] : [] });
      if (!matches) {
        if (
          typeof frame.params?.runId !== 'string' ||
          this.knownTurns.get(frame.params.runId) !== frame.params?.sessionKey
        )
          unexpected.push('chat.abort binding mismatch');
        return;
      }
      this.activeTurn = null;
      heldTurn = undefined;
      const message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Synthetic response stopped.' }],
        timestamp: 1789084800001,
      };
      sessionHistory(turn.sessionKey).push(
        { role: 'user', content: [{ type: 'text', text: turn.message }], timestamp: 1789084800000 },
        message,
      );
      queueMicrotask(() =>
        this.receive({
          type: 'event',
          event: 'chat',
          payload: { sessionKey: turn.sessionKey, runId: turn.runId, state: 'aborted', message },
        }),
      );
      return;
    }
    const responses: Record<string, unknown> = {
      'agents.list': { agents: [{ id: 'fixture-agent', name: 'Fixture agent' }] },
      'sessions.list': { sessions: [] },
      'chat.history': {
        messages: sessionHistory(
          String(frame.params?.sessionKey ?? 'agent:fixture-agent:main'),
        ).slice(),
      },
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
    if (
      frame.method === 'chat.history' &&
      fixtureBridge.historyGate?.(() =>
        reply({
          messages: sessionHistory(
            String(frame.params?.sessionKey ?? 'agent:fixture-agent:main'),
          ).slice(),
        }),
      )
    )
      return;
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
    if (url.pathname === '/api/assistant/decision-events' && method === 'POST')
      return json({ accepted: JSON.parse(String(init?.body)).events.length });
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
