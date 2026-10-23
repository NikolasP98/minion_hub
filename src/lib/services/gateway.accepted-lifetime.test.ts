// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
    beginRequest = vi.fn(async (_method: string, params: { idempotencyKey: string }) => ({
      runId: params.idempotencyKey,
    }));
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
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
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

import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
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
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        throw new Error('PROBE_NETWORK_FORBIDDEN');
      }
    },
  );
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

import {
  createAcceptedSurface,
  resetAcceptedRuns,
  claimRunFinal,
  getAcceptedRun,
} from '$lib/assistant/accepted-runs';
import { createPendingSubmissions } from '$lib/assistant/pending-submission';
import { getPageContextRevision, onPageContextChange } from '$lib/assistant/page-context';
import { registerGlobalTools } from '$lib/assistant/global-tools';
import { guide, endGuide } from '$lib/assistant/guide.svelte';
import { runAssistantUiCalls } from '$lib/assistant/dispatch';
import { sendAssistantTurn } from '$lib/services/gateway/chat-rpc';
import { ensureAgentChat } from '$lib/state/chat/chat.svelte';

it.each(['socket reconnect', 'manual reconnect', 'expiry'] as const)(
  'actual ui.guide cannot start after %s during its target wait',
  async (boundary) => {
    endGuide();
    const node = document.createElement('button');
    node.dataset.assist = 'review.target';
    document.body.append(node);
    const offTools = registerGlobalTools();
    await wsConnect();
    const client = authenticate(0, 'probe-before');
    await settle();
    const scope = {
      actorId: 'actor',
      orgId: 'org',
      agentId: 'owned',
      sessionKey: 'agent:owned:main',
    };
    const followUp = vi.fn(async () => true);
    const surface = createAcceptedSurface({ readScope: () => scope, followUp });
    const offContext = onPageContextChange((change) => surface.contextChanged(change));
    const pending = createPendingSubmissions();
    pending.setScope(scope);
    const turn = pending.begin(0, getPageContextRevision());
    const chat = ensureAgentChat('owned');
    chat.sending = false;
    chat.runId = null;
    chat.sessionKey = scope.sessionKey;
    try {
      const sent = sendAssistantTurn(scope.agentId, 'show this', 'fixture', scope.sessionKey, {
        runId: turn.submissionId,
        binding: { pending: turn, surface },
      });
      expect(sent.status).toBe('submitted');
      const binding = claimRunFinal(sent.runId, scope.sessionKey)!;
      expect(binding).toBeDefined();
      const running = runAssistantUiCalls(
        scope.agentId,
        '```minion-ui\n' +
          JSON.stringify({
            tool: 'ui.guide',
            input: { steps: [{ target: 'review.target', message: 'Review step' }] },
          }) +
          '\n```',
        scope.sessionKey,
        binding,
      );
      expect(guide.active).toBe(false);
      if (boundary === 'socket reconnect') {
        client.options.onClose?.(1006, 'review loss');
        client.options.onAuthenticated?.(hello('probe-after'), { generation: 2 });
        await settle();
      } else if (boundary === 'manual reconnect') {
        await wsConnect();
        authenticate(1, 'probe-new-client');
        await settle();
      } else {
        vi.setSystemTime(binding.expiresAt + 1);
      }
      await vi.advanceTimersByTimeAsync(300);
      await running;
      expect(guide.active).toBe(false);
      expect(guide.steps).toHaveLength(0);
      expect(followUp).not.toHaveBeenCalled();
    } finally {
      surface.dispose();
      offContext();
      offTools();
      node.remove();
      endGuide();
      resetAcceptedRuns();
    }
  },
);

it('stale old client close cannot revoke a successor accepted run', async () => {
  await wsConnect();
  const old = authenticate(0, 'old');
  await settle();
  await wsConnect();
  authenticate(1, 'successor');
  await settle();
  const scope = {
    actorId: 'actor',
    orgId: 'org',
    agentId: 'owned',
    sessionKey: 'agent:owned:main',
  };
  const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
  const pending = createPendingSubmissions();
  pending.setScope(scope);
  const turn = pending.begin(0, getPageContextRevision());
  const chat = ensureAgentChat('owned');
  chat.sending = false;
  chat.runId = null;
  chat.sessionKey = scope.sessionKey;
  try {
    const sent = sendAssistantTurn(scope.agentId, 'successor', 'fixture', scope.sessionKey, {
      runId: turn.submissionId,
      binding: { pending: turn, surface },
    });
    expect(sent.status).toBe('submitted');
    old.options.onClose?.(1006, 'late old socket');
    const binding = claimRunFinal(sent.runId, scope.sessionKey);
    expect(binding?.controller.signal.aborted).toBe(false);
    expect(binding?.state).toBe('claimed');
  } finally {
    surface.dispose();
    resetAcceptedRuns();
  }
});

it.each(['error', 'aborted'] as const)(
  'old accepted %s event revokes its pending tool after a new run is displayed',
  async (state) => {
    endGuide();
    const node = document.createElement('button');
    node.dataset.assist = 'review.target';
    document.body.append(node);
    const offTools = registerGlobalTools();
    await wsConnect();
    const client = authenticate(0, 'terminal-probe');
    await settle();
    const scope = {
      actorId: 'actor',
      orgId: 'org',
      agentId: 'owned',
      sessionKey: 'agent:owned:main',
    };
    const followUp = vi.fn(async () => true);
    const surface = createAcceptedSurface({ readScope: () => scope, followUp });
    const offContext = onPageContextChange((change) => surface.contextChanged(change));
    const pending = createPendingSubmissions();
    pending.setScope(scope);
    const turn = pending.begin(0, getPageContextRevision());
    const chat = ensureAgentChat('owned');
    chat.sending = false;
    chat.runId = null;
    chat.sessionKey = scope.sessionKey;
    try {
      const sent = sendAssistantTurn(scope.agentId, 'show this', 'fixture', scope.sessionKey, {
        runId: turn.submissionId,
        binding: { pending: turn, surface },
      });
      expect(sent.status).toBe('submitted');
      const text =
        '```minion-ui\n' +
        JSON.stringify({
          tool: 'ui.guide',
          input: { steps: [{ target: 'review.target', message: 'Review step' }] },
        }) +
        '\n```';
      client.options.onEvent?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: scope.sessionKey,
          runId: sent.runId,
          state: 'final',
          message: { role: 'assistant', content: [{ type: 'text', text }] },
        },
      });
      await settle();
      const binding = getAcceptedRun(sent.runId)!;
      expect(binding.state).toBe('claimed');
      expect(guide.active).toBe(false);
      const next = pending.begin(1, getPageContextRevision());
      const sentB = sendAssistantTurn(scope.agentId, 'new turn B', 'fixture', scope.sessionKey, {
        runId: next.submissionId,
        binding: { pending: next, surface },
      });
      expect(sentB.status).toBe('submitted');
      expect(chat.runId).toBe(sentB.runId);
      client.options.onEvent?.({
        type: 'event',
        event: 'chat',
        payload: {
          sessionKey: scope.sessionKey,
          runId: sent.runId,
          state,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Terminal old run' }] },
        },
      });
      await settle();
      expect.soft(binding.controller.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      await settle();
      expect(chat.runId).toBe(sentB.runId);
      expect(getAcceptedRun(sentB.runId)?.controller.signal.aborted).toBe(false);
      expect.soft(guide.active).toBe(false);
    } finally {
      surface.dispose();
      offContext();
      offTools();
      node.remove();
      endGuide();
      resetAcceptedRuns();
    }
  },
);

it('actual gateway tool events alias only exact known run/session objects', async () => {
  const { sourceMessageRun } = await import('$lib/assistant/accepted-runs');
  await wsConnect();
  const client = authenticate(0, 'tools');
  await settle();
  const scope = {
    actorId: 'actor',
    orgId: 'org',
    agentId: 'owned',
    sessionKey: 'agent:owned:main',
  };
  const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
  const pending = createPendingSubmissions();
  pending.setScope(scope);
  const turn = pending.begin(0, getPageContextRevision());
  const chat = ensureAgentChat('owned');
  chat.sending = false;
  chat.runId = null;
  chat.liveTools = [];
  chat.sessionKey = scope.sessionKey;
  try {
    const sent = sendAssistantTurn(scope.agentId, 'show tool', 'fixture', scope.sessionKey, {
      runId: turn.submissionId,
      binding: { pending: turn, surface },
    });
    expect(sent.status).toBe('submitted');
    const binding = getAcceptedRun(sent.runId)!;
    const start = (runId: string, id: string) =>
      client.options.onEvent?.({
        type: 'event',
        event: 'agent',
        payload: {
          agentId: scope.agentId,
          runId,
          sessionKey: scope.sessionKey,
          stream: 'tool',
          data: { phase: 'start', name: 'chat_artifact', toolCallId: id, args: { buttons: [] } },
        },
      });
    start(sent.runId, 'known');
    expect(sourceMessageRun(chat.liveTools[0])).toBe(binding);
    start(crypto.randomUUID(), 'unknown');
    expect(sourceMessageRun(chat.liveTools[1])).toBeUndefined();
    expect(sourceMessageRun({ ...chat.liveTools[0] })).toBeUndefined();
  } finally {
    surface.dispose();
    resetAcceptedRuns();
  }
});
