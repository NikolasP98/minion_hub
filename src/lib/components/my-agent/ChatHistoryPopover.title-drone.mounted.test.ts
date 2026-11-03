// @vitest-environment happy-dom
/**
 * Spec 045 T038: the chat history popover upgrades missing session titles with
 * the `drones.session-title` drone — a gateway-admin call. A member after the
 * switch keeps the first-prompt title and never makes (or fails) the call.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

// Spy on the component's own caller: the transport's role refusal would otherwise hide a removed skip.
const sent = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock('$lib/services/gateway-rpc', async (orig) => {
  const real = await orig<typeof import('$lib/services/gateway-rpc')>();
  return {
    ...real,
    sendRequest: (...args: Parameters<typeof real.sendRequest>) => {
      sent.spy(...args);
      return real.sendRequest(...args);
    },
  };
});

import ChatHistoryPopover from './ChatHistoryPopover.svelte';
import { setClient } from '$lib/services/gateway-rpc';

const request = vi.fn();
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const droneCalls = () => sent.spy.mock.calls.filter(([m]) => m === 'drones.session-title').length;

async function openHistory() {
  const view = render(ChatHistoryPopover, {
    agentId: 'a1',
    activeSessionKey: 'agent:a1:main',
    onselect: vi.fn(),
  });
  const trigger = view.container.querySelector('button') as HTMLElement;
  await fireEvent.click(trigger);
  await settle();
  return view;
}

beforeEach(() => {
  request.mockReset();
  sent.spy.mockReset();
  request.mockImplementation(async (method: string) =>
    method === 'sessions.list'
      ? { sessions: [{ key: 'agent:a1:main', lastMessagePreview: 'hello there' }] }
      : { title: 'Greeting' },
  );
  setClient({ request } as never);
});
afterEach(() => {
  cleanup();
  setClient(null);
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('a member after the switch: the sessions load, the title drone is never called', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  await openHistory();
  expect(request.mock.calls.some(([m]) => m === 'sessions.list')).toBe(true);
  expect(droneCalls()).toBe(0);
}, 10_000);

it('flag unset: the title drone is called as before', async () => {
  page.data = { user: { role: 'user' } };
  await openHistory();
  expect(droneCalls()).toBe(1);
}, 10_000);

it('a platform admin after the switch: the title drone is called', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  await openHistory();
  expect(droneCalls()).toBe(1);
}, 10_000);
