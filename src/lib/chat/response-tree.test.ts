import { describe, expect, it } from 'vitest';
import { normalizeTurnBranches, projectTurnBranches } from './response-tree';

const rows = [
  { key: 'u1', role: 'user' as const },
  { key: 'a1', role: 'assistant' as const },
  { key: 'u2', role: 'user' as const },
  { key: 'a2', role: 'assistant' as const },
];

describe('projectTurnBranches', () => {
  it('shows only the active retry at the original turn position', () => {
    expect(
      projectTurnBranches(rows, { u1: { attempts: ['u1', 'u2'], active: 1 } }).map((r) => r.key),
    ).toEqual(['u2', 'a2']);
  });

  it('keeps the original turn when navigating back', () => {
    expect(
      projectTurnBranches(rows, { u1: { attempts: ['u1', 'u2'], active: 0 } }).map((r) => r.key),
    ).toEqual(['u1', 'a1']);
  });

  it('preserves all history before the edited prompt', () => {
    const withHistory = [
      { key: 'u0', role: 'user' as const },
      { key: 'a0', role: 'assistant' as const },
      ...rows,
    ];
    expect(
      projectTurnBranches(withHistory, { u1: { attempts: ['u1', 'u2'], active: 1 } }).map(
        (r) => r.key,
      ),
    ).toEqual(['u0', 'a0', 'u2', 'a2']);
  });

  it('does not hide anything while persisted attempt keys are incomplete', () => {
    expect(
      projectTurnBranches(rows.slice(0, 2), { u1: { attempts: ['u1', 'u2'], active: 1 } }),
    ).toEqual(rows.slice(0, 2));
  });
});

describe('normalizeTurnBranches', () => {
  it('validates persisted state and clamps the selected attempt', () => {
    expect(normalizeTurnBranches({ u1: { attempts: ['u1', 'u2', 'u2'], active: 99 } })).toEqual({
      u1: { attempts: ['u1', 'u2'], active: 1 },
    });
  });
});
