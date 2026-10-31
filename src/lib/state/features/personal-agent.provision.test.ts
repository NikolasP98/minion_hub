/**
 * Spec 045 T035a: browser provisioning goes through the hub route that holds the
 * gateway admin credential, never `agents.create` on the browser's own socket.
 */
import { afterEach, expect, it, vi } from 'vitest';

const sendRequest = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/gateway-rpc', () => ({ sendRequest }));

import { personalAgent } from './personal-agent.svelte';

afterEach(() => vi.unstubAllGlobals());

it('asks the hub to create a pending agent and keeps the provision-status check', async () => {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', url]);
      if (url === '/api/personal-agent/provision')
        return new Response(JSON.stringify({ needsProvisioning: true, payload: { name: 'x' } }));
      if (url === '/api/personal-agent/create') return new Response('{"ok":true,"agentId":"x"}');
      return new Response(JSON.stringify({ agent: null }));
    }),
  );
  await personalAgent.checkAndProvision();
  expect(calls.slice(0, 2)).toEqual([
    ['GET', '/api/personal-agent/provision'],
    ['POST', '/api/personal-agent/create'],
  ]);
  expect(sendRequest).not.toHaveBeenCalled();
});

it('does nothing when no agent is pending', async () => {
  const fetchSpy = vi.fn(async () => new Response('{"needsProvisioning":false}'));
  vi.stubGlobal('fetch', fetchSpy);
  await personalAgent.checkAndProvision();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
