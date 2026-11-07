// @vitest-environment happy-dom
/**
 * Spec 045 T038 (H2): /chat/settings (was /home/settings, spec 046) saves the member's own agent through the hub
 * route, in both flag states, and never sends `config.patch` from the browser.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

import Page from './+page.svelte';
import { setClient } from '$lib/services/gateway-rpc';
import { conn } from '$lib/state/gateway/connection.svelte';
import { configState } from '$lib/state/config/config.svelte';

const request = vi.fn();
const fetchMock = vi.fn();
const settle = async () => {
  for (let i = 0; i < 25; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 10));
  }
};
const data = {
  agent: {
    id: 'pa1',
    userId: 'u1',
    agentId: 'personal-u1',
    avatarUrl: null,
    provisioningStatus: 'active',
    provisioningError: null,
    createdAt: 1,
    updatedAt: 1,
  },
  channelIdentities: [],
  userName: 'Ana',
};
const settingsCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/personal-agent/settings');

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (method: string) =>
    method === 'config.get'
      ? {
          hash: 'h',
          config: {
            agents: {
              list: [
                {
                  id: 'personal-u1',
                  identity: { name: 'Old' },
                  personality: { configured: true, preset: 'casual', text: 'hi' },
                },
              ],
            },
          },
        }
      : {},
  );
  setClient({ request } as never);
  conn.connected = true;
  configState.loaded = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  setClient(null);
  conn.connected = false;
  vi.unstubAllGlobals();
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

async function rename() {
  const view = render(Page);
  await settle();
  const input = view.container.querySelector('input[type="text"]') as HTMLInputElement;
  await fireEvent.input(input, { target: { value: 'New name' } });
  await fireEvent.blur(input);
  await settle();
}

for (const [label, flag, role] of [
  ['member after the switch', 'false', 'user'],
  ['flag unset', undefined, 'user'],
] as const) {
  it(`${label}: the rename goes to the hub route and no config.patch leaves the browser`, async () => {
    if (flag) publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = flag;
    page.data = { ...data, user: { role } };
    await rename();
    expect(settingsCalls()).toHaveLength(1);
    expect(JSON.parse(settingsCalls()[0][1].body)).toEqual({ name: 'New name' });
    expect(request.mock.calls.some(([m]) => m === 'config.patch')).toBe(false);
  }, 20_000);
}

it('a 403 from the route says "your role can\'t"', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
  page.data = { ...data, user: { role: 'user' } };
  const view = render(Page);
  await settle();
  const input = view.container.querySelector('input[type="text"]') as HTMLInputElement;
  await fireEvent.input(input, { target: { value: 'Nope' } });
  await fireEvent.blur(input);
  await settle();
  expect(view.container.textContent).toMatch(/role can.?t|rol no puede|tu rol/i);
}, 20_000);
