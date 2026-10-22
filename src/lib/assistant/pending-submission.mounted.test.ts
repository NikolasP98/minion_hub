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
import { requestRouteDecision } from './turn-router';
import { getClient, sendRequest } from '$lib/services/gateway-rpc';
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('$app/state', async () => import('../../../tests/fixtures/pending-submission/page.svelte'));
vi.mock('$lib/assistant/turn-router', async (original) => ({
  ...(await original<typeof import('./turn-router')>()),
  requestRouteDecision: vi.fn(),
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
let release!: (value: null) => void;
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
