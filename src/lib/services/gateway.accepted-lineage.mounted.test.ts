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
});

import { resetAcceptedRuns, getAcceptedRun } from '$lib/assistant/accepted-runs';
import { createPendingSubmissions } from '$lib/assistant/pending-submission';
import { getPageContextRevision } from '$lib/assistant/page-context';
import { sendAssistantTurn } from '$lib/services/gateway/chat-rpc';
import { ensureAgentChat } from '$lib/state/chat/chat.svelte';

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync, type ComponentProps } from 'svelte';
import Home from '../../routes/(app)/home/+page.svelte';
import { page } from '../../../tests/fixtures/pending-submission/page.svelte';
import { sourceMessageRun } from '$lib/assistant/accepted-runs';
import { decisionEvents } from '$lib/assistant/decision-events';
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('$app/state', async () => import('../../../tests/fixtures/pending-submission/page.svelte'));
vi.mock('$lib/assistant/turn-router', async (original) => ({
  ...(await original<typeof import('$lib/assistant/turn-router')>()),
  requestRouteDecisionWithEvidence: async () => ({ decision: null, attempt: null }),
}));
vi.mock('$lib/state/features/voice-call.svelte', () => ({
  voiceCall: { active: false },
  mouth: {},
  startCall: vi.fn(),
  endCall: vi.fn(),
  toggleMute: vi.fn(),
}));

beforeEach(() => {
  flushSync(() => {
    page.data.user.id = 'actor';
    page.data.activeOrgId = 'org';
    page.data.personalAgent.agent.agentId = 'owned';
    page.url = new URL('http://localhost/home');
  });
  const chat = ensureAgentChat('owned');
  chat.sending = false;
  chat.runId = null;
  chat.sessionKey = 'agent:owned:main';
  chat.messages.splice(0);
  chat.liveTools = [];
  chat.stream = null;
  chat.streamMessage = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  if (!Element.prototype.animate)
    Element.prototype.animate = (() => ({
      cancel() {},
      finished: Promise.resolve(),
    })) as unknown as typeof Element.prototype.animate;
});
afterEach(() => {
  cleanup();
  decisionEvents.setOwner({ actorId: '', orgId: '' });
  resetAcceptedRuns();
  vi.restoreAllMocks();
});

it.each(['known', 'unknown', 'mixed'] as const)(
  'mounted Home %s sources use actual gateway ingestion at the five-follow-up cap',
  async (mode) => {
    await wsConnect();
    const client = authenticate(0, 'mounted-lineage');
    await settle();
    const view = render(Home, {
      data: {
        user: { id: 'actor' },
        activeOrgId: 'org',
        personalAgent: { agent: { agentId: 'owned' } },
      } as unknown as ComponentProps<typeof Home>['data'],
    });
    const input = await waitFor(() => view.getByRole('textbox') as HTMLTextAreaElement);
    await fireEvent.input(input, { target: { value: 'Actual gateway lineage root' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    const chat = ensureAgentChat('owned');
    await waitFor(() => expect(chat.runId).toBeTruthy());
    let binding = getAcceptedRun(chat.runId)!;
    expect(binding).toBeDefined();
    const root = binding.taskRootId;
    const delta = (runId: string) =>
      client.options.onEvent?.({
        type: 'event',
        event: 'chat',
        payload: { sessionKey: 'agent:owned:main', runId, state: 'delta' },
      });
    const scope = {
      actorId: 'actor',
      orgId: 'org',
      agentId: 'owned',
      sessionKey: 'agent:owned:main',
    };
    const pending = createPendingSubmissions();
    pending.setScope(scope);
    // Admit five real automatic children through the production sender. The final
    // child supplies the artifact event, while each prior run has actually started.
    for (let n = 1; n <= 5; n++) {
      delta(binding.runId);
      await settle();
      const turn = pending.begin(n, getPageContextRevision());
      const sent = sendAssistantTurn('owned', '', 'fixture', 'agent:owned:main', {
        runId: turn.submissionId,
        silent: true,
        binding: {
          pending: turn,
          surface: binding.surface,
          origin: 'ui_followup',
          parent: binding,
        },
      });
      expect(sent.status).toBe('submitted');
      binding = getAcceptedRun(sent.runId)!;
      expect(binding.followUpCount).toBe(n);
    }
    delta(binding.runId);
    await settle();
    const start = (runId: string, id: string, name: string, args: unknown) =>
      client.options.onEvent?.({
        type: 'event',
        event: 'agent',
        payload: {
          agentId: 'owned',
          runId,
          sessionKey: 'agent:owned:main',
          stream: 'tool',
          data: { phase: 'start', name, toolCallId: id, args },
        },
      });
    start(
      mode === 'unknown' ? crypto.randomUUID() : binding.runId,
      'actual-artifact',
      'chat_artifact',
      {
        html: '',
        buttons: [{ text: 'Actual ingested artifact', callback_data: 'ACTUAL_CALLBACK' }],
      },
    );
    expect(sourceMessageRun(chat.liveTools[0])).toBe(mode === 'unknown' ? undefined : binding);
    if (mode === 'mixed') start(crypto.randomUUID(), 'unknown-extra', 'fixture.read', {});
    expect(chat.streamMessage).toBeNull();
    await fireEvent.click(await view.findByRole('button', { name: 'Actual ingested artifact' }));
    await waitFor(() => expect(chat.runId).not.toBe(binding.runId));
    const child = getAcceptedRun(chat.runId)!;
    expect(child).toBeDefined();
    expect(child.origin).toBe('artifact');
    if (mode === 'known') {
      expect(child.parentRunId).toBe(binding.runId);
      expect(child.taskRootId).toBe(root);
      expect(child.followUpCount).toBe(5);
      delta(child.runId);
      await settle();
      const turn = pending.begin(6, getPageContextRevision());
      const blocked = sendAssistantTurn('owned', '', 'fixture', 'agent:owned:main', {
        runId: turn.submissionId,
        silent: true,
        binding: { pending: turn, surface: child.surface, origin: 'ui_followup', parent: child },
      });
      expect(blocked.status).toBe('rejected');
      expect(getAcceptedRun(turn.submissionId)).toBeUndefined();
    } else {
      expect(child.parentRunId).toBeNull();
      expect(child.taskRootId).not.toBe(root);
      expect(child.followUpCount).toBe(0);
    }
  },
);
