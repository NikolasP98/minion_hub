// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import AgentDashboard from './AgentDashboard.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { gw } from '$lib/state/gateway/gateway-data.svelte';

afterEach(() => {
  cleanup();
  conn.connected = false;
  gw.sessions = [];
});

it('mounts the production agent dashboard without presenting fleet reliability as agent data', () => {
  conn.connected = false;
  gw.sessions = [];
  const view = render(AgentDashboard, {
    agentId: 'agent-alpha',
    agent: { id: 'agent-alpha', name: 'Alpha' },
  });

  expect(view.getByRole('link', { name: /open reliability/i }).getAttribute('href')).toBe(
    '/reliability',
  );
  expect(view.getByText(/agent-specific reliability is unavailable/i)).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/errors today/i);
});
