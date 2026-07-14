import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canViewPath, goto, visibleAgents } = vi.hoisted(() => ({
  canViewPath: vi.fn<(path: string) => boolean>(),
  goto: vi.fn(),
  visibleAgents: { value: [{ id: 'agent-1', name: 'Scout', emoji: '🔎' }] },
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath }));
vi.mock('$lib/state/gateway/gateway-data.svelte', () => ({ visibleAgents }));
vi.mock('$lib/nav/routes', () => ({
  palettePageRoutes: () => [
    { path: '/overview', title: () => 'Overview', paletteIcon: 'home', keywords: 'dashboard' },
  ],
}));

import { getFilteredCommands, palette } from './command-palette.svelte';

describe('command palette route-policy parity', () => {
  beforeEach(() => {
    palette.query = '';
    canViewPath.mockReset();
  });

  it('hides page, action, and entity commands when their executable path is denied', () => {
    canViewPath.mockImplementation((path) => path !== '/agents' && path !== '/agents/builder');

    const commands = getFilteredCommands().flatMap((group) => group.commands);

    expect(commands.map((command) => command.id)).not.toContain('agent:agent-1');
    expect(commands.map((command) => command.id)).not.toContain('action:new-agent');
    expect(commands.map((command) => command.id)).toContain('page:/overview');
  });

  it('records the destination policy on every built-in action', () => {
    canViewPath.mockReturnValue(true);

    const actions = getFilteredCommands()
      .flatMap((group) => group.commands)
      .filter((command) => command.category === 'action');

    expect(actions).toEqual([
      expect.objectContaining({ id: 'action:new-agent', requiresPath: '/agents/builder' }),
      expect.objectContaining({ id: 'action:settings', requiresPath: '/settings' }),
    ]);
  });
});
