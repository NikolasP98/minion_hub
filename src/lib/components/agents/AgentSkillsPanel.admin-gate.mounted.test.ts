// @vitest-environment happy-dom
/**
 * Spec 045 T038: an in-page control behind `agents.skills.set` — the per-skill
 * toggle — is absent for a member after the switch, present for a platform
 * admin, and present for a member while the flag is unset.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';

vi.mock('$lib/state/agents/agent-skills.svelte', async () => {
  const state = {
    skills: [{ skillKey: 'k1', name: 'Writer', agentEnabled: true, disabled: false }],
    loading: false,
    saving: false,
    error: null,
  };
  return {
    agentSkillsState: state,
    loadAgentSkills: vi.fn(),
    setAgentSkills: vi.fn(),
  };
});

import AgentSkillsPanel from './AgentSkillsPanel.svelte';

const toggles = (c: HTMLElement) =>
  c.querySelectorAll('[data-scope="switch"][data-part="root"]').length;

async function show() {
  const view = render(AgentSkillsPanel, { agentId: 'a1' });
  await tick();
  return view;
}

beforeEach(() => {
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
});
afterEach(() => {
  cleanup();
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

it('member after the switch: the skill is listed, its toggle is not rendered', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'user' } };
  const { container } = await show();
  expect(container.textContent).toContain('Writer');
  expect(toggles(container)).toBe(0);
  // The state is kept as a read-only indicator, not a lock or a message.
  expect(container.querySelector('[data-part="skill-status"]')).not.toBeNull();
});

it('platform admin after the switch: the toggle is rendered', async () => {
  publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
  page.data = { user: { role: 'admin' } };
  const { container } = await show();
  expect(toggles(container)).toBeGreaterThan(0);
});

it('member with the flag unset: the toggle is rendered', async () => {
  page.data = { user: { role: 'user' } };
  const { container } = await show();
  expect(toggles(container)).toBeGreaterThan(0);
});
