// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync, tick, type ComponentProps } from 'svelte';
import { page } from '../../../tests/fixtures/pending-submission/page.svelte';
import Home from '../../routes/(app)/home/+page.svelte';
import Floating from '$lib/components/layout/FloatingAssistant.svelte';
import { assistant } from '$lib/state/features/assistant.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { ensureAgentChat } from '$lib/state/chat/chat.svelte';
import { requestRouteDecision, type RouteDecision } from './turn-router';
import { decisionEvents } from './decision-events';
import { getClient, sendRequest } from '$lib/services/gateway-rpc';
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('$app/state', async () => import('../../../tests/fixtures/pending-submission/page.svelte'));
const routeMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/assistant/turn-router', async (original) => ({
  ...(await original<typeof import('./turn-router')>()),
  requestRouteDecision: routeMock,
  requestRouteDecisionWithEvidence: async (...args: unknown[]) => ({
    decision: await routeMock(...args),
    attempt: null,
  }),
}));
vi.mock('$lib/services/gateway.svelte', async () => ({
  ...(await import('$lib/services/gateway/chat-rpc')),
  sendRequest: (await import('$lib/services/gateway-rpc')).sendRequest,
}));
vi.mock('$lib/services/gateway-rpc', () => ({
  getClient: vi.fn(() => ({
    beginRequest: (...args: Parameters<typeof sendRequest>) => sendRequest(...args),
  })),
  sendRequest: vi.fn(async (method: string) => (method === 'chat.history' ? { messages: [] } : {})),
  gwTrace: vi.fn(),
}));
vi.mock('$lib/state/features/voice-call.svelte', () => ({
  voiceCall: { active: false },
  mouth: {},
  startCall: vi.fn(),
  endCall: vi.fn(),
  toggleMute: vi.fn(),
}));
let release!: (value: RouteDecision | null) => void;
beforeEach(() => {
  flushSync(() => {
    page.data.user.id = 'actor-a';
    page.data.activeOrgId = 'org-a';
    page.data.personalAgent.agent.agentId = 'agent-a';
    page.url = new URL('http://localhost/home');
    conn.connected = true;
    assistant.open = true;
  });
  for (const id of ['agent-a', 'agent-b']) {
    const chat = ensureAgentChat(id);
    chat.sending = false;
    chat.stream = null;
    chat.runId = null;
    chat.sessionKey = `agent:${id}:main`;
    chat.messages.splice(0);
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ aliases: {}, notes: [] })),
  );
  vi.mocked(requestRouteDecision).mockClear();
  vi.mocked(requestRouteDecision).mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  vi.mocked(getClient).mockReturnValue({
    beginRequest: (...args: Parameters<typeof sendRequest>) => sendRequest(...args),
  } as unknown as ReturnType<typeof getClient>);
  vi.mocked(sendRequest).mockClear();
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(surface: 'Home' | 'Floating') {
  if (surface === 'Floating')
    flushSync(() => {
      page.url = new URL('http://localhost/crm');
    });
  const view =
    surface === 'Home'
      ? render(Home, {
          data: { userName: 'Fixture', greeting: 'Hello', openedIds: [] } as ComponentProps<
            typeof Home
          >['data'],
        })
      : render(Floating);
  const input = await waitFor(() => view.getByRole('textbox') as HTMLTextAreaElement);
  await fireEvent.input(input, { target: { value: 'keep my draft' } });
  await fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(requestRouteDecision).toHaveBeenCalled());
  return { view, input };
}
describe.each(['Home', 'Floating'] as const)('%s actual submission surface', (surface) => {
  it('Stop during deferred routing sends zero and preserves the draft', async () => {
    const { view, input } = await mount(surface);
    await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
    release(null);
    await tick();
    await tick();
    expect(input.value).toBe('keep my draft');
    expect(
      vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
    ).toHaveLength(0);
  });
  it.each(['actor', 'org', 'agent', 'page'] as const)(
    '%s A → B → A invalidates deferred routing',
    async (field) => {
      const { input } = await mount(surface);
      const change = (other: boolean) =>
        flushSync(() => {
          if (field === 'actor') page.data.user.id = other ? 'actor-b' : 'actor-a';
          if (field === 'org') page.data.activeOrgId = other ? 'org-b' : 'org-a';
          if (field === 'agent')
            page.data.personalAgent.agent.agentId = other ? 'agent-b' : 'agent-a';
          if (field === 'page')
            page.url = new URL(
              other
                ? 'http://localhost/other'
                : surface === 'Home'
                  ? 'http://localhost/home'
                  : 'http://localhost/crm',
            );
        });
      change(true);
      change(false);
      release(null);
      await tick();
      await tick();
      expect(
        vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
      ).toHaveLength(0);
      if (field === 'actor' || field === 'org') expect(input.value).toBe('');
      else expect(input.value).toBe('keep my draft');
    },
  );
  it('preparation Stop cannot abort a replacement run', async () => {
    const { view } = await mount(surface);
    flushSync(() => {
      const chat = ensureAgentChat('agent-a');
      chat.runId = 'replacement';
      chat.sending = true;
    });
    await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
    release(null);
    await tick();
    await tick();
    expect(
      vi
        .mocked(sendRequest)
        .mock.calls.filter(([method]) => method === 'chat.abort' || method === 'chat.send'),
    ).toHaveLength(0);
  });
  it.each(['thread', 'owner'] as const)(
    'Stop after submitted A targets the displayed %s B with its exact run',
    async (field) => {
      const { view, input } = await mount(surface);
      release(null);
      await waitFor(() => expect(input.value).toBe(''));
      const sent = vi.mocked(sendRequest).mock.calls.find(([method]) => method === 'chat.send');
      expect(sent).toBeDefined();
      flushSync(() => {
        if (field === 'owner') {
          page.data.user.id = 'actor-b';
          page.data.activeOrgId = 'org-b';
        }
        const chat = ensureAgentChat('agent-a');
        chat.sessionKey = 'agent:agent-a:thread-b';
        chat.runId = 'run-b';
        chat.sending = true;
      });
      await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
      expect(sendRequest).toHaveBeenLastCalledWith('chat.abort', {
        sessionKey: 'agent:agent-a:thread-b',
        runId: 'run-b',
      });
    },
  );
  it('synchronous busy rejection preserves draft after routing', async () => {
    const { input } = await mount(surface);
    flushSync(() => {
      ensureAgentChat('agent-a').sending = true;
    });
    release(null);
    await tick();
    await tick();
    expect(input.value).toBe('keep my draft');
    expect(
      vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
    ).toHaveLength(0);
  });
  it('thread A → B → A during deferred routing never revives the turn', async () => {
    const { input } = await mount(surface);
    flushSync(() => {
      ensureAgentChat('agent-a').sessionKey = 'agent:agent-a:other';
    });
    flushSync(() => {
      ensureAgentChat('agent-a').sessionKey = 'agent:agent-a:main';
    });
    release(null);
    await tick();
    await tick();
    expect(input.value).toBe('keep my draft');
    expect(
      vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
    ).toHaveLength(0);
  });
});

describe.each(['Home', 'Floating'] as const)(
  '%s accepted signal and Stop during smoothing',
  (surface) => {
    it('successful preparation cleanup leaves the accepted signal live; exact Stop after runId clears revokes it', async () => {
      const { getAcceptedRun, resetAcceptedRuns } = await import('./accepted-runs');
      const { view, input } = await mount(surface);
      release(null);
      await waitFor(() => expect(input.value).toBe(''));
      const sent = vi.mocked(sendRequest).mock.calls.find(([method]) => method === 'chat.send');
      expect(sent).toBeDefined();
      const params = sent![1] as { idempotencyKey: string; sessionKey: string };
      const binding = getAcceptedRun(params.idempotencyKey)!;
      expect(binding).toBeDefined();
      expect(binding.controller.signal.aborted).toBe(false);
      flushSync(() => {
        const chat = ensureAgentChat('agent-a');
        chat.runId = null;
        chat.sending = false;
        chat.stream = 'pending smoother';
      });
      await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
      expect(binding.controller.signal.aborted).toBe(true);
      expect(sendRequest).toHaveBeenLastCalledWith('chat.abort', {
        sessionKey: params.sessionKey,
        runId: params.idempotencyKey,
      });
      resetAcceptedRuns();
    });
  },
);

describe.each(['Home', 'Floating'] as const)(
  '%s actual sender with held sandbox handoff',
  (surface) => {
    it.each([
      'valid',
      'navigation',
      'owner',
      'session',
      'registration',
      'stop',
      'unmount',
      'failed_refresh',
    ] as const)('%s permits only one acknowledged fresh continuation', async (variant) => {
      const { createPageContextLease } = await import('./page-context');
      const { getAcceptedRun, claimRunFinal, resetAcceptedRuns } = await import('./accepted-runs');
      const { registerTool } = await import('./model-context');
      const { runAssistantUiCalls } = await import('./dispatch');
      const { registerSandboxTools } = await import('$lib/sandbox/tools');
      const { createSandboxHost } = await import('$lib/sandbox/host.svelte');
      const lease = createPageContextLease('initial fixture canvas');
      const host = createSandboxHost([], {
        begin: lease.invalidate,
        publish: (elements, capability) => lease.update(JSON.stringify(elements), capability),
      });
      const tools = new AbortController();
      registerSandboxTools({ signal: tools.signal, acknowledge: host.load });
      const next = vi.fn();
      const offNext = registerTool({
        name: 'fixture.old_next',
        description: '',
        inputSchema: {},
        execute: next,
      });
      let releaseReload!: (response: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, init) => {
          if (url === '/api/sandbox/elements' && init?.method === 'POST')
            return Response.json({ id: 'committed-fixture' });
          if (url === '/api/sandbox/elements')
            return new Promise<Response>((resolve) => (releaseReload = resolve));
          return Response.json({ aliases: {}, notes: [], accepted: 1 });
        }),
      );
      let offUnrelated: (() => void) | undefined;
      try {
        const { view, input } = await mount(surface);
        release(null);
        await waitFor(() => expect(input.value).toBe(''));
        const sent = vi.mocked(sendRequest).mock.calls.find(([method]) => method === 'chat.send');
        const params = sent![1] as { idempotencyKey: string; sessionKey: string };
        const binding = getAcceptedRun(params.idempotencyKey)!;
        const response =
          '```minion-ui\n' +
          JSON.stringify([
            {
              tool: 'sandbox.upsert_element',
              input: { title: 'Fixture', html: '<p>Fixture</p>', js: '' },
            },
            { tool: 'fixture.old_next', input: {} },
          ]) +
          '\n```';
        // The real final handler clears transport sending/run state before its smoother callback.
        flushSync(() => {
          const chat = ensureAgentChat('agent-a');
          chat.sending = false;
          chat.runId = null;
          chat.stream = response;
        });
        const running = runAssistantUiCalls(
          'agent-a',
          response,
          params.sessionKey,
          claimRunFinal(binding.runId, params.sessionKey),
        );
        await waitFor(() => expect(releaseReload).toBeDefined());
        if (variant === 'navigation')
          flushSync(() => {
            page.url = new URL('http://localhost/other');
          });
        if (variant === 'owner') {
          flushSync(() => {
            page.data.user.id = 'actor-b';
          });
          flushSync(() => {
            page.data.user.id = 'actor-a';
          });
        }
        if (variant === 'session') {
          flushSync(() => {
            ensureAgentChat('agent-a').sessionKey = 'agent:agent-a:other';
          });
          flushSync(() => {
            ensureAgentChat('agent-a').sessionKey = params.sessionKey;
          });
        }
        if (variant === 'registration')
          offUnrelated = registerTool({
            name: 'fixture.unrelated',
            description: '',
            inputSchema: {},
            execute() {},
          });
        if (variant === 'stop') {
          flushSync(() => {
            const chat = ensureAgentChat('agent-a');
            chat.stream = null;
            chat.streamMessage = null;
          });
          await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
        }
        if (variant === 'unmount') view.unmount();
        releaseReload(
          variant === 'failed_refresh'
            ? new Response('', { status: 503 })
            : Response.json({ elements: [{ id: 'committed-fixture' }] }),
        );
        await running;
        await tick();
        expect(next).not.toHaveBeenCalled();
        expect(
          vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
        ).toHaveLength(variant === 'valid' ? 2 : 1);
        expect(
          vi
            .mocked(fetch)
            .mock.calls.filter(
              ([url, init]) => url === '/api/sandbox/elements' && init?.method === 'POST',
            ),
        ).toHaveLength(1);
      } finally {
        offUnrelated?.();
        offNext();
        tools.abort();
        lease.dispose();
        resetAcceptedRuns();
      }
    });
  },
);

describe.each(['Home', 'Floating'] as const)(
  '%s actual callback and decision observations',
  (surface) => {
    it.each(['ui_choice', 'artifact'] as const)(
      'history %s bypasses classifier and starts a new explicit root without guessing a parent',
      async (origin) => {
        const { decisionEvents } = await import('./decision-events');
        const seen: Array<import('./decision-lineage').DecisionEvent> = [];
        const off = decisionEvents.subscribe((event) => seen.push(event));
        try {
          const { view, input } = await mount(surface);
          release(null);
          await waitFor(() => expect(input.value).toBe(''));
          flushSync(() => {
            const chat = ensureAgentChat('agent-a');
            chat.sending = false;
            chat.runId = null;
            chat.stream = null;
            chat.messages.push({
              role: 'assistant',
              content:
                origin === 'artifact'
                  ? [
                      {
                        type: 'toolCall',
                        id: 'artifact-fixture',
                        name: 'chat_artifact',
                        arguments: {
                          html: '',
                          buttons: [
                            { text: 'Artifact fixture', callback_data: 'FIXTURE_CALLBACK' },
                          ],
                        },
                      },
                    ]
                  : [
                      {
                        type: 'text',
                        text:
                          '```minion-ui\n' +
                          JSON.stringify([
                            {
                              tool: 'ui.choice',
                              input: {
                                question: 'Pick a fixture option',
                                options: [{ label: 'Choose fixture' }],
                              },
                            },
                          ]) +
                          '\n```',
                      },
                    ],
              timestamp: Date.now(),
            });
          });
          await fireEvent.click(
            await view.findByRole('button', {
              name: origin === 'artifact' ? 'Artifact fixture' : 'Choose fixture',
            }),
          );
          await waitFor(() =>
            expect(
              vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
            ).toHaveLength(2),
          );
          expect(requestRouteDecision).toHaveBeenCalledTimes(1);
          const relation = seen.find(
            (event) => event.kind === 'run_relation' && event.origin === origin,
          );
          expect(relation).toBeDefined();
          expect(relation?.taskRootId).toBe(relation?.submissionId);
          expect(relation?.parentRunId).toBeUndefined();
          expect(
            seen.find((event) => event.kind === 'decision_applied' && event.origin === origin),
          ).toMatchObject({
            decision_disposition: 'bypass',
            loaded_pages: true,
            loaded_forms: true,
            loaded_data: true,
            loaded_brain: true,
            loaded_changelog: true,
            loaded_sandbox: true,
          });
        } finally {
          off();
        }
      },
    );
    it('successful classification followed by Stop is prepared/discarded and never applied', async () => {
      const { decisionEvents } = await import('./decision-events');
      const seen: Array<import('./decision-lineage').DecisionEvent> = [];
      const off = decisionEvents.subscribe((event) => seen.push(event));
      try {
        const { view } = await mount(surface);
        await fireEvent.click(view.getByRole('button', { name: /Stop|Detener/i }));
        release({ mode: 'chat', probabilities: { chat: 1 }, manifests: {}, ms: 7, cost: 0 });
        await tick();
        await tick();
        expect(seen.find((event) => event.kind === 'decision_prepared')).toMatchObject({
          decision_disposition: 'routed',
        });
        expect(seen.find((event) => event.kind === 'decision_discarded')).toMatchObject({
          decision_disposition: 'canceled',
          reason: 'user_stop',
        });
        expect(seen.some((event) => event.kind === 'decision_applied')).toBe(false);
      } finally {
        off();
      }
    });
  },
);

describe('Home merged live-tool streaming callback lineage', () => {
  it.each(['ui_choice', 'artifact'] as const)(
    '%s retains the exact live source when rendering synthesizes a merged message',
    async (origin) => {
      const { getAcceptedRun, claimRunFinal, associateRunMessage } =
        await import('./accepted-runs');
      const seen: Array<import('./decision-lineage').DecisionEvent> = [];
      const off = decisionEvents.subscribe((event) => seen.push(event));
      try {
        const { view, input } = await mount('Home');
        release(null);
        await waitFor(() => expect(input.value).toBe(''));
        const sent = vi.mocked(sendRequest).mock.calls.find(([method]) => method === 'chat.send');
        const params = sent![1] as { idempotencyKey: string; sessionKey: string };
        const binding = getAcceptedRun(params.idempotencyKey)!;
        expect(claimRunFinal(binding.runId, params.sessionKey)).toBe(binding);
        const text =
          '```minion-ui\n' +
          JSON.stringify([
            {
              tool: 'ui.choice',
              input: {
                question: 'Pick a live fixture option',
                options: [{ label: 'Live choice fixture' }],
              },
            },
          ]) +
          '\n```';
        flushSync(() => {
          const chat = ensureAgentChat('agent-a');
          chat.sending = false;
          chat.runId = null;
          chat.liveTools = [
            { id: 'live-fixture-tool', name: 'fixture.read', input: {}, done: false },
          ];
          chat.stream = text;
          chat.streamDisplay = origin === 'ui_choice' ? text : '';
          chat.streamMessage = {
            role: 'assistant',
            content:
              origin === 'ui_choice'
                ? [{ type: 'text', text }]
                : [
                    {
                      type: 'toolCall',
                      id: 'live-artifact-fixture',
                      name: 'chat_artifact',
                      arguments: {
                        html: '',
                        buttons: [
                          { text: 'Live artifact fixture', callback_data: 'LIVE_FIXTURE_CALLBACK' },
                        ],
                      },
                    },
                  ],
            timestamp: Date.now(),
          };
          associateRunMessage(chat.streamMessage, binding);
          associateRunMessage(chat.liveTools[0], binding);
        });
        expect(ensureAgentChat('agent-a').liveTools).toHaveLength(1);
        await fireEvent.click(
          await view.findByRole('button', {
            name: origin === 'ui_choice' ? 'Live choice fixture' : 'Live artifact fixture',
          }),
        );
        await waitFor(() =>
          expect(
            vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
          ).toHaveLength(2),
        );
        const child = seen.find(
          (event) => event.kind === 'run_relation' && event.origin === origin,
        );
        expect(child).toMatchObject({
          parentRunId: binding.runId,
          taskRootId: binding.taskRootId,
          follow_up_count: 0,
        });
        expect(requestRouteDecision).toHaveBeenCalledTimes(1);
      } finally {
        off();
      }
    },
  );
});

describe.each(['Home', 'Floating'] as const)(
  '%s explicit callbacks at the automatic follow-up cap',
  (surface) => {
    it.each(['ui_choice', 'artifact'] as const)(
      '%s remains available with exact lineage and full context at five; typed text starts a new root',
      async (origin) => {
        const { getAcceptedRun, claimRunFinal, associateRunMessage, finishRun } =
          await import('./accepted-runs');
        const { view, input } = await mount(surface);
        release(null);
        await waitFor(() => expect(input.value).toBe(''));
        const sends = () =>
          vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send');
        const latest = () =>
          getAcceptedRun((sends().at(-1)![1] as { idempotencyKey: string }).idempotencyKey)!;
        const finish = () => {
          const run = latest();
          claimRunFinal(run.runId, run.sessionKey);
          finishRun(run);
          flushSync(() => {
            const chat = ensureAgentChat('agent-a');
            chat.sending = false;
            chat.runId = null;
            chat.stream = null;
            chat.streamMessage = null;
          });
        };
        let parent = latest();
        const root = parent.taskRootId;
        for (let count = 1; count <= 5; count++) {
          claimRunFinal(parent.runId, parent.sessionKey);
          finish();
          if (count === 5) {
            const before = sends().length;
            vi.mocked(getClient).mockReturnValueOnce({
              beginRequest: () => {
                throw Error('Definite fixture dispatch rejection');
              },
            } as unknown as ReturnType<typeof getClient>);
            expect(
              await parent.surface.followUp(parent, 'Rejected work consumes no automatic slot\n'),
            ).toBe(false);
            expect(sends()).toHaveLength(before);
          }
          expect(await parent.surface.followUp(parent, 'Read-only fixture results\n')).toBe(true);
          parent = latest();
          expect(parent.followUpCount).toBe(count);
          expect(parent.taskRootId).toBe(root);
        }
        finish();
        const before = sends().length;
        expect(await parent.surface.followUp(parent, 'No sixth silent fixture turn\n')).toBe(false);
        expect(sends()).toHaveLength(before);
        flushSync(() => {
          const chat = ensureAgentChat('agent-a');
          chat.messages.push({
            role: 'assistant',
            content:
              origin === 'artifact'
                ? [
                    {
                      type: 'toolCall',
                      id: 'cap-artifact',
                      name: 'chat_artifact',
                      arguments: {
                        html: '',
                        buttons: [{ text: 'Cap artifact fixture', callback_data: 'CAP_CALLBACK' }],
                      },
                    },
                  ]
                : [
                    {
                      type: 'text',
                      text:
                        '```minion-ui\n' +
                        JSON.stringify([
                          {
                            tool: 'ui.choice',
                            input: {
                              question: 'Pick at five',
                              options: [{ label: 'Cap choice fixture' }],
                            },
                          },
                        ]) +
                        '\n```',
                    },
                  ],
            timestamp: Date.now(),
          });
          associateRunMessage(chat.messages[chat.messages.length - 1], parent);
        });
        await fireEvent.click(
          await view.findByRole('button', {
            name: origin === 'artifact' ? 'Cap artifact fixture' : 'Cap choice fixture',
          }),
        );
        await waitFor(() => expect(sends()).toHaveLength(before + 1));
        const explicit = latest();
        expect(explicit).toMatchObject({
          origin,
          taskRootId: root,
          parentRunId: parent.runId,
          followUpCount: 5,
        });
        expect(requestRouteDecision).toHaveBeenCalledTimes(1);
        const sent = (sends().at(-1)![1] as { message: string }).message;
        expect(sent).toContain('In-app assistant context');
        expect(sent).toContain('dashboard');
        finish();
        expect(await explicit.surface.followUp(explicit, 'Still no sixth automatic\n')).toBe(false);
        expect(sends()).toHaveLength(before + 1);
        await fireEvent.input(input, { target: { value: 'A genuinely new typed fixture task' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(requestRouteDecision).toHaveBeenCalledTimes(2));
        release(null);
        await waitFor(() => expect(sends()).toHaveLength(before + 2));
        expect(latest().followUpCount).toBe(0);
        expect(latest().taskRootId).toBe(latest().submissionId);
        expect(latest().taskRootId).not.toBe(root);
      },
    );
  },
);

it('a callback from an unknown merged live-tool source must not borrow the bound stream parent', async () => {
  const { getAcceptedRun, claimRunFinal, associateRunMessage } =
    await import('$lib/assistant/accepted-runs');
  const seen: Array<{
    kind: string;
    origin?: unknown;
    parentRunId?: unknown;
    taskRootId?: unknown;
  }> = [];
  const off = decisionEvents.subscribe((event) => seen.push(event));
  try {
    const { view, input } = await mount('Home');
    release(null);
    await waitFor(() => expect(input.value).toBe(''));
    const sent = vi.mocked(sendRequest).mock.calls.find(([method]) => method === 'chat.send');
    const params = sent![1] as { idempotencyKey: string; sessionKey: string };
    const binding = getAcceptedRun(params.idempotencyKey)!;
    expect(claimRunFinal(binding.runId, params.sessionKey)).toBe(binding);
    flushSync(() => {
      const chat = ensureAgentChat('agent-a');
      chat.sending = false;
      chat.runId = null;
      chat.liveTools = [
        {
          id: 'unknown-artifact',
          name: 'chat_artifact',
          input: {
            html: '',
            buttons: [{ text: 'Unknown live artifact', callback_data: 'UNKNOWN_LIVE_CALLBACK' }],
          },
          done: false,
        },
      ];
      chat.stream = 'Known answer';
      chat.streamDisplay = 'Known answer';
      chat.streamMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Known answer' }],
        timestamp: Date.now(),
      };
      associateRunMessage(chat.streamMessage, binding);
    });
    await fireEvent.click(await view.findByRole('button', { name: 'Unknown live artifact' }));
    await waitFor(() =>
      expect(
        vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
      ).toHaveLength(2),
    );
    const child = seen.find(
      (event) => event.kind === 'run_relation' && event.origin === 'artifact',
    );

    expect(child).toBeDefined();
    expect(child?.parentRunId).toBeUndefined();
    expect(child?.taskRootId).not.toBe(binding.taskRootId);
  } finally {
    off();
  }
});
