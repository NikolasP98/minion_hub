// @vitest-environment happy-dom
/**
 * Spec 045 A3 audit F2: /account/connections must not spin. The channel-plugin
 * list loads once per connection, never in a loop on failure, and not at all
 * for a member once the browser connects with its own JWT.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

vi.mock('$lib/state/features/hosts.svelte', () => ({
  hostsState: { activeHostId: 'h1', hosts: [] },
}));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('$lib/services/gateway.svelte', async () => {
  const rpc = await import('$lib/services/gateway-rpc');
  return { sendRequest: rpc.sendRequest, requestWhatsAppPair: vi.fn() };
});

import ChannelLinking from './ChannelLinking.svelte';
import { setClient } from '$lib/services/gateway-rpc';
import { conn } from '$lib/state/gateway/connection.svelte';

const request = vi.fn();
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const pluginListCalls = () =>
  request.mock.calls.filter(([method]) => method === 'channels.plugins.list').length;

beforeEach(() => {
  request.mockReset();
  setClient({ request } as never);
  conn.connected = true;
});
afterEach(() => {
  cleanup();
  setClient(null);
  conn.connected = false;
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('a member after the switch: no plugin-list call, no loop, no setup-sync', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  const { container } = render(ChannelLinking, { userId: 'u1', identities: [] });
  await settle();
  expect(pluginListCalls()).toBe(0);
  expect(container.textContent).not.toMatch(/Refresh|Actualizar/);
}, 10_000);

it('a failed load is tried once per connection, not in a loop', async () => {
  request.mockRejectedValue(new Error('missing scope: operator.admin'));
  render(ChannelLinking, { userId: 'u1', identities: [] });
  await settle();
  expect(pluginListCalls()).toBe(1);
}, 10_000);

it('an empty list is loaded once, not re-requested forever', async () => {
  request.mockResolvedValue({ plugins: [] });
  render(ChannelLinking, { userId: 'u1', identities: [] });
  await settle();
  expect(pluginListCalls()).toBe(1);
}, 10_000);
