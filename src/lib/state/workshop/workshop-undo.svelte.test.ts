/**
 * Unit tests for the Workshop structural undo stack.
 *
 * The undo functions mutate module-level `$state` (`workshopState`,
 * `undoState`). Reads happen synchronously right after the mutating call, so no
 * `$effect` scope is needed — we assert against the current proxy value.
 *
 * This file is `.svelte.test.ts` so the Svelte compiler transforms the rune
 * usage in the imported module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// workshop.svelte transitively imports features/hosts.svelte → user.svelte,
// which pull SvelteKit/auth/env virtual modules unresolvable under vitest. None
// are touched by the undo path; stub them so the module graph imports.
vi.mock('$app/state', () => ({ page: { data: {}, params: {}, url: new URL('http://localhost/') } }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}) }));
vi.mock('$lib/auth', () => ({ authClient: { signOut: vi.fn(async () => {}) } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTH_PROVIDER: 'better-auth' } }));
vi.mock('$lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn(async () => {}) } }),
}));

import {
  workshopState,
  resetWorkshop,
  addAgentInstance,
  addRelationship,
  pushUndoCheckpoint,
  popUndoCheckpoint,
  clearUndoHistory,
  undoState,
} from './workshop.svelte';

beforeEach(() => {
  resetWorkshop();
  clearUndoHistory();
});

const agentCount = () => Object.keys(workshopState.agents).length;
const relCount = () => Object.keys(workshopState.relationships).length;

describe('workshop structural undo', () => {
  it('starts with nothing to undo', () => {
    expect(undoState.canUndo).toBe(false);
    expect(popUndoCheckpoint()).toBe(false);
  });

  it('undoes an agent add (delete-restore is the inverse case)', () => {
    pushUndoCheckpoint();
    addAgentInstance('agent-a', 10, 20);
    expect(agentCount()).toBe(1);
    expect(undoState.canUndo).toBe(true);

    expect(popUndoCheckpoint()).toBe(true);
    expect(agentCount()).toBe(0);
    expect(undoState.canUndo).toBe(false);
  });

  it('restores a deleted agent (the case the panel called out as the one that matters)', () => {
    const id1 = addAgentInstance('agent-a', 0, 0);
    addAgentInstance('agent-b', 5, 5);
    expect(agentCount()).toBe(2);

    // Delete agent-a with a checkpoint, as removeAgentFromCanvas does.
    pushUndoCheckpoint();
    delete workshopState.agents[id1];
    expect(agentCount()).toBe(1);

    expect(popUndoCheckpoint()).toBe(true);
    expect(agentCount()).toBe(2);
    expect(workshopState.agents[id1]?.agentId).toBe('agent-a');
  });

  it('restores relationships alongside agents', () => {
    const a = addAgentInstance('agent-a', 0, 0);
    const b = addAgentInstance('agent-b', 1, 1);
    pushUndoCheckpoint();
    addRelationship(a, b, 'mentors');
    expect(relCount()).toBe(1);

    popUndoCheckpoint();
    expect(relCount()).toBe(0);
    expect(agentCount()).toBe(2);
  });

  it('is LIFO across multiple checkpoints', () => {
    pushUndoCheckpoint();
    addAgentInstance('a', 0, 0);
    pushUndoCheckpoint();
    addAgentInstance('b', 0, 0);
    expect(agentCount()).toBe(2);

    popUndoCheckpoint(); // undo the 'b' add
    expect(agentCount()).toBe(1);
    popUndoCheckpoint(); // undo the 'a' add
    expect(agentCount()).toBe(0);
    expect(undoState.canUndo).toBe(false);
  });

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      pushUndoCheckpoint();
      addAgentInstance(`agent-${i}`, i, i);
    }
    expect(agentCount()).toBe(25);

    // Only the last 20 checkpoints survive; popping them all leaves the 5
    // pre-cap agents that no checkpoint can restore-away.
    let pops = 0;
    while (popUndoCheckpoint()) pops++;
    expect(pops).toBe(20);
    expect(agentCount()).toBe(5);
  });

  it('restored state is mutable (no frozen snapshot leaks back in)', () => {
    const id = addAgentInstance('agent-a', 0, 0);
    pushUndoCheckpoint();
    addAgentInstance('agent-b', 1, 1);
    popUndoCheckpoint();

    // Mutating a restored agent must not throw (would if it were frozen).
    expect(() => {
      workshopState.agents[id].position = { x: 99, y: 99 };
    }).not.toThrow();
    expect(workshopState.agents[id].position.x).toBe(99);
  });

  it('clearUndoHistory empties the stack', () => {
    pushUndoCheckpoint();
    addAgentInstance('a', 0, 0);
    expect(undoState.canUndo).toBe(true);

    clearUndoHistory();
    expect(undoState.canUndo).toBe(false);
    expect(popUndoCheckpoint()).toBe(false);
  });
});
