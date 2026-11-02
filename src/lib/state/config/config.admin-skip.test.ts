/** Spec 045 T038: `loadConfig` never asks a non-admin's pass for `config.schema`. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

const rpc = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock('$lib/services/gateway-rpc', () => ({ sendRequest: rpc.sendRequest }));

import { loadConfig } from './config.svelte';

const methods = () => rpc.sendRequest.mock.calls.map(([m]) => m);

beforeEach(() => {
  rpc.sendRequest.mockReset();
  rpc.sendRequest.mockImplementation(async (method: string) =>
    method === 'config.get' ? { config: {}, hash: 'h' } : { schema: {}, uiHints: {}, version: '1' },
  );
});
afterEach(() => {
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('member after the switch: config.get only, no config.schema', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  await loadConfig();
  expect(methods()).toContain('config.get');
  expect(methods()).not.toContain('config.schema');
});

it('platform admin after the switch: asks for the schema', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  await loadConfig();
  expect(methods()).toContain('config.schema');
});

it('flag unset: asks for the schema as before', async () => {
  page.data = { user: { role: 'user' } };
  await loadConfig();
  expect(methods()).toContain('config.schema');
});
