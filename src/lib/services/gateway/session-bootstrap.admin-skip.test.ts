/** Spec 045 T038: a member's dashboard does not re-register flow triggers after the switch. */
import { afterEach, expect, it, vi } from 'vitest';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';
import { startSessionBootstrap, type SessionBootstrap } from './session-bootstrap';

const flow = {
  flows: [
    {
      id: 'f1',
      nodes: [{ type: 'trigger', data: { event: 'message', deliverResponse: false } }],
    },
  ],
};

async function boot() {
  const request = vi.fn(async () => ({}));
  const fetcher = vi.fn(async () => new Response(JSON.stringify(flow)));
  const options: SessionBootstrap = {
    current: () => true,
    request,
    fetcher,
    agents: vi.fn(),
    sessions: vi.fn(),
    health: vi.fn(),
    presence: vi.fn(),
    channels: vi.fn(),
    cron: vi.fn(),
    agentsError: vi.fn(),
  };
  const stop = startSessionBootstrap(options);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  stop();
  return { request, fetcher };
}
const registered = (r: ReturnType<typeof vi.fn>) =>
  r.mock.calls.filter(([m]) => m === 'flows.trigger.register').length;

afterEach(() => {
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('member after the switch: no flows fetch, no registration', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  const { request, fetcher } = await boot();
  expect(fetcher).not.toHaveBeenCalled();
  expect(registered(request)).toBe(0);
});

it('platform admin after the switch: triggers are re-registered', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  const { request } = await boot();
  expect(registered(request)).toBe(1);
});

it('flag unset: triggers are re-registered as before', async () => {
  page.data = { user: { role: 'user' } };
  const { request } = await boot();
  expect(registered(request)).toBe(1);
});
