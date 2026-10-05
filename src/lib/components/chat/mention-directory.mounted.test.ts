// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import {
  ACTOR,
  PERSON,
  ORG_A,
  ORG_B,
  page,
} from '../../../../tests/fixtures/mention-directory/page.svelte';
import ChatMessage from './ChatMessage.svelte';
import ChatInput from '../my-agent/ChatInput.svelte';
import TeamTab from '../users/TeamTab.svelte';
import * as Sentry from '@sentry/sveltekit';
import { invalidateAliases } from '$lib/state/features/aliases.svelte';

vi.mock(
  '$app/state',
  async () => await import('../../../../tests/fixtures/mention-directory/page.svelte'),
);
vi.mock('$app/environment', () => ({ browser: true, dev: true, building: false }));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));
// HC036 owns Gateway skill reads. These unrelated sources must not perform HTTP
// in the actual alias consumer tests; the alias module itself is never replaced.
vi.mock('$lib/state/agents/agent-skills.svelte', () => ({
  // The alias-only checkpoint precedes HC036; keep its unrelated legacy API dormant too.
  agentSkillsState: { skills: [] },
  loadAgentSkills: async () => {},
  createAgentSkillsResource: () => ({ data: null, reset() {}, dispose() {}, load: async () => {} }),
}));
vi.mock('$lib/state/agents/agent-resource-owner.svelte', () => ({
  captureAgentResourceOwner: () => null,
  captureGatewayResourceOwner: () => null,
}));
vi.mock('$lib/state/gateway/gateway-data.svelte', () => ({ visibleAgents: { value: [] } }));
vi.mock('$lib/state/gateway', () => ({ conn: { connected: false } }));
vi.mock('$lib/state/features/channel-sources.svelte', () => ({
  channelPlugins: () => [],
  ensureChannelPlugins: async () => [],
}));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('$lib/state/features/permissions.svelte', () => ({ can: () => false }));
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

const response = (org = ORG_A, alias = 'colleague') =>
  Response.json({ actorId: ACTOR, organizationId: org, aliases: { [PERSON]: alias } });
const message = { role: 'user', content: '@colleague <plain text>' };

let clock = 0;
beforeEach(() => {
  page.data.activeOrgId = ORG_A;
  clock += 120_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.mocked(Sentry.captureException).mockClear();
  // Happy DOM has no layout. Supply measured viewport/row dimensions only;
  // keep the actual DataTable virtualizer and Team controls running.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function typeMention(view: { getByRole(role: 'textbox'): HTMLElement }, text: string) {
  const input = view.getByRole('textbox') as HTMLTextAreaElement;
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  await fireEvent.input(input);
  await fireEvent.keyUp(input, { key: 'e' });
  return input;
}

it('actual message and composer share one read and preserve mention rendering and suggestions', async () => {
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toBe('/api/users/aliases');
    return response();
  });
  vi.stubGlobal('fetch', fetcher);
  const bubble = render(ChatMessage, { message });
  const composer = render(ChatInput);
  await waitFor(() =>
    expect(bubble.container.querySelector('.mention')?.getAttribute('data-user-id')).toBe(PERSON),
  );
  const input = await typeMention(composer, '@col');
  expect(await composer.findByRole('option', { name: /colleague/ })).toBeTruthy();
  expect(input.value).toBe('@col');
  expect(bubble.container.textContent).toContain('<plain text>');
  expect(bubble.container.querySelector('plain')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('contains a failed read without breaking typing and recovers through real invalidation', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic unavailable'))
    .mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetcher);
  const bubble = render(ChatMessage, { message });
  const composer = render(ChatInput);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const input = await typeMention(composer, 'ordinary text');
  expect(input.value).toBe('ordinary text');
  expect(bubble.container.querySelector('.mention')).toBeNull();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  invalidateAliases();
  await waitFor(() => expect(bubble.container.querySelector('.mention')).not.toBeNull());
  await typeMention(composer, '@col');
  expect(await composer.findByRole('option', { name: /colleague/ })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('owner replacement removes visible old mentions and rejects an out-of-order reply', async () => {
  const replies: Array<(response: Response) => void> = [];
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => replies.push(resolve)));
  vi.stubGlobal('fetch', fetcher);
  const bubble = render(ChatMessage, { message });
  await waitFor(() => expect(replies).toHaveLength(1));
  flushSync(() => {
    page.data.activeOrgId = ORG_B;
  });
  expect(bubble.container.querySelector('.mention')).toBeNull();
  await waitFor(() => expect(replies).toHaveLength(2));
  replies[1](response(ORG_B, 'current_person'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  replies[0](response(ORG_A));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(bubble.container.querySelector('.mention')).toBeNull();
  await bubble.rerender({ message: { role: 'user', content: '@current_person' } });
  await waitFor(() =>
    expect(bubble.container.querySelector('.mention')?.getAttribute('data-user-id')).toBe(PERSON),
  );
});

it('shares lifecycle listeners and removes them after the last actual consumer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const first = render(ChatMessage, { message });
  const second = render(ChatMessage, { message });
  const subscriptions = added.mock.calls.filter(([type]) => type === 'online');
  expect(subscriptions).toHaveLength(1);
  first.unmount();
  expect(removed.mock.calls.filter(([type]) => type === 'online')).toHaveLength(0);
  second.unmount();
  expect(removed.mock.calls.filter(([type]) => type === 'online')).toEqual([
    ['online', subscriptions[0][1]],
  ]);
});

it('preserves cooldown and categorical reporting across last-consumer teardown and remount', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('private synthetic failure'));
  vi.stubGlobal('fetch', fetcher);
  const first = render(ChatMessage, { message });
  await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = render(ChatMessage, { message });
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  clock += 30_000;
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  second.unmount();
  const third = render(ChatMessage, { message });
  clock += 30_000;
  window.dispatchEvent(new Event('online'));
  await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(2));
  expect(fetcher).toHaveBeenCalledTimes(3);
  third.unmount();
  fetcher.mockResolvedValue(response());
  invalidateAliases(); // Confirmed mutation while no readers are mounted.
  const fourth = render(ChatMessage, { message });
  await waitFor(() => expect(fourth.container.querySelector('.mention')).not.toBeNull());
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(vi.mocked(Sentry.captureException).mock.calls)).not.toContain(
    'private synthetic',
  );
});

const roster = [
  {
    id: PERSON,
    email: 'colleague@example.test',
    displayName: 'Colleague',
    role: 'user' as const,
    alias: 'colleague',
    memberRoles: [],
    createdAt: null,
    organizations: [{ id: ORG_A, name: 'Studio North', role: 'staff' }],
  },
];

it.each([true, false])(
  'actual Team membership controls invalidate only confirmed mutations even if roster refresh fails: success=%j',
  async (success) => {
    let directoryReads = 0;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/users/aliases') {
        directoryReads++;
        return directoryReads === 1
          ? response()
          : Response.json({ actorId: ACTOR, organizationId: ORG_A, aliases: {} });
      }
      if (url === '/api/join-links') return Response.json({ links: [] });
      if (url === `/api/users/${PERSON}` && options?.method === 'PATCH')
        return new Response(null, { status: success ? 204 : 403 });
      if (url === '/api/users') return new Response(null, { status: 503 });
      throw new Error(`Unexpected synthetic route ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const bubble = render(ChatMessage, { message });
    const team = render(TeamTab, {
      initialUsers: roster,
      organizations: [{ id: ORG_A, name: 'Studio North' }],
    });
    await waitFor(() => expect(bubble.container.querySelector('.mention')).not.toBeNull());
    await fireEvent.click(team.getByRole('button', { name: 'Studio North' }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url, options]) => url === `/api/users/${PERSON}` && options?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    if (success) {
      await waitFor(() => expect(directoryReads).toBe(2));
      await waitFor(() => expect(bubble.container.querySelector('.mention')).toBeNull());
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(directoryReads).toBe(1);
      expect(bubble.container.querySelector('.mention')).not.toBeNull();
    }
  },
);

it.each(['approve', 'deny'] as const)(
  'actual Team join review invalidates membership changes and preserves denials: %s',
  async (action) => {
    let directoryReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/users/aliases') {
          directoryReads++;
          return response();
        }
        if (url === '/api/join-links') return Response.json({ links: [] });
        if (url === `/api/join-requests/request-one/${action}`)
          return new Response(null, { status: 204 });
        throw new Error(`Unexpected synthetic route ${url}`);
      }),
    );
    render(ChatMessage, { message });
    const team = render(TeamTab, {
      initialUsers: roster,
      organizations: [{ id: ORG_A, name: 'Studio North' }],
      initialPendingRequests: [
        {
          id: 'request-one',
          email: 'new@example.test',
          organizationId: ORG_A,
          createdAt: '2026-10-03T00:00:00Z',
        },
      ],
    });
    await waitFor(() => expect(directoryReads).toBe(1));
    await fireEvent.click(
      team.getByRole('button', { name: action === 'approve' ? /approve/i : /deny/i }),
    );
    await waitFor(() => expect(team.queryByText('new@example.test')).toBeNull());
    expect(directoryReads).toBe(action === 'approve' ? 2 : 1);
  },
);

it.each([true, false])(
  'actual Team deletion refreshes mentions only on confirmed success: %j',
  async (success) => {
    let directoryReads = 0;
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === '/api/users/aliases') {
          directoryReads++;
          return directoryReads === 1
            ? response()
            : Response.json({ actorId: ACTOR, organizationId: ORG_A, aliases: {} });
        }
        if (url === '/api/join-links') return Response.json({ links: [] });
        if (url === `/api/users/${PERSON}` && options?.method === 'DELETE')
          return new Response(null, { status: success ? 204 : 403 });
        throw new Error(`Unexpected synthetic route ${url}`);
      }),
    );
    const bubble = render(ChatMessage, { message });
    const team = render(TeamTab, { initialUsers: roster });
    await waitFor(() => expect(bubble.container.querySelector('.mention')).not.toBeNull());
    await fireEvent.click(await team.findByRole('button', { name: 'Actions' }));
    const removeItem = await team.findByRole('menuitem', { name: 'Delete user' });
    await fireEvent.pointerDown(removeItem, { pointerType: 'mouse' });
    await fireEvent.pointerUp(removeItem, { pointerType: 'mouse' });
    await fireEvent.click(removeItem);
    expect(confirm).toHaveBeenCalledOnce();
    if (success) {
      await waitFor(() => expect(directoryReads).toBe(2));
      await waitFor(() => expect(bubble.container.querySelector('.mention')).toBeNull());
    } else {
      await waitFor(() => expect(team.getByText(/remove/i)).toBeTruthy());
      expect(directoryReads).toBe(1);
      expect(bubble.container.querySelector('.mention')).not.toBeNull();
    }
  },
);
