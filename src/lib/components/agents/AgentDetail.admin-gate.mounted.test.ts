// @vitest-environment happy-dom
/**
 * Spec 045 T038: the agent Files and Prompt tabs and the settings gear are
 * absent for a member after the switch, present for a platform admin, and
 * present for a member while the flag is unset.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

// Only the tab bar and header are under test; the tab bodies are heavy and irrelevant.
vi.mock('../chat/ChatPanel.svelte', () => ({ default: () => {} }));
vi.mock('../sessions/SessionViewer.svelte', () => ({ default: () => {} }));
vi.mock('../sessions/SessionKanban.svelte', () => ({ default: () => {} }));
vi.mock('../sessions/SessionMonitor.svelte', () => ({ default: () => {} }));
vi.mock('../sessions/SessionDropdown.svelte', () => ({ default: () => {} }));
vi.mock('./AgentDashboard.svelte', () => ({ default: () => {} }));
vi.mock('./AgentMemoryPanel.svelte', () => ({ default: () => {} }));
vi.mock('./PiAgentTab.svelte', () => ({ default: () => {} }));
vi.mock('./AgentSettingsPanel.svelte', () => ({ default: () => {} }));
vi.mock('./AgentFiles.svelte', () => ({ default: () => {} }));
vi.mock('./AgentPromptSimulator.svelte', () => ({ default: () => {} }));
vi.mock('./AgentCapabilitiesPanel.svelte', () => ({ default: () => {} }));

import AgentDetail from './AgentDetail.svelte';
import { setClient } from '$lib/services/gateway-rpc';
import * as m from '$lib/paraglide/messages';

const agent = { id: 'a1', name: 'Agent One' } as never;

async function show() {
  const view = render(AgentDetail, { agentId: 'a1', agent });
  await tick();
  return view;
}
const tabs = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button')).map((b) => b.textContent?.trim());
const gear = (c: HTMLElement) => c.querySelector(`button[title="${m.detail_agentSettings()}"]`);

beforeEach(() => setClient({ request: vi.fn(async () => ({})) } as never));
afterEach(() => {
  cleanup();
  setClient(null);
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('member after the switch: no Files tab, no Prompt tab, no settings gear', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  const { container } = await show();
  expect(tabs(container)).toContain(m.agent_tabChat());
  expect(tabs(container)).not.toContain(m.agent_tabFiles());
  expect(tabs(container)).not.toContain(m.agent_tabPrompt());
  expect(gear(container)).toBeNull();
});

it('platform admin after the switch: all three are rendered', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  const { container } = await show();
  expect(tabs(container)).toContain(m.agent_tabFiles());
  expect(tabs(container)).toContain(m.agent_tabPrompt());
  expect(gear(container)).not.toBeNull();
});

it('member with the flag unset: all three are rendered', async () => {
  page.data = { user: { role: 'user' } };
  const { container } = await show();
  expect(tabs(container)).toContain(m.agent_tabFiles());
  expect(tabs(container)).toContain(m.agent_tabPrompt());
  expect(gear(container)).not.toBeNull();
});
