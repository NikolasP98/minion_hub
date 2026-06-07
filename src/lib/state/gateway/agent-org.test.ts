import { describe, it, expect } from 'vitest';
import { isFacesAgent, filterAgentsByOrg, type OrgRef } from './agent-org';

const FACES = 'org-faces-uuid';
const MINION = 'org-minion-uuid';
const ORGS: OrgRef[] = [
  { id: FACES, slug: 'faces-sculptors' },
  { id: MINION, slug: 'minion' },
];

const AGENTS = [
  { id: 'faces_bot_prd', name: 'faces_bot_prd' },
  { id: 'a1', name: 'Faces Sculptors' },
  { id: 'bj_bot', name: 'bj_bot' },
  { id: 'public', name: 'PUBLIC' },
  { id: 'leiva_bot', name: 'leiva_bot' },
];

describe('isFacesAgent', () => {
  it('matches "faces" in name, case-insensitively', () => {
    expect(isFacesAgent({ id: 'x', name: 'Faces Sculptors' })).toBe(true);
    expect(isFacesAgent({ id: 'x', name: 'faces_bot_prd' })).toBe(true);
  });
  it('matches "faces" in id when name is missing', () => {
    expect(isFacesAgent({ id: 'faces_bot_prd' })).toBe(true);
    expect(isFacesAgent({ id: 'x', name: null })).toBe(false);
  });
  it('is false for non-faces agents', () => {
    expect(isFacesAgent({ id: 'bj_bot', name: 'bj_bot' })).toBe(false);
    expect(isFacesAgent({ id: 'public', name: 'PUBLIC' })).toBe(false);
  });
});

describe('filterAgentsByOrg', () => {
  it('shows only FACES agents when the FACES org is active', () => {
    const out = filterAgentsByOrg(AGENTS, FACES, ORGS).map((a) => a.id);
    expect(out).toEqual(['faces_bot_prd', 'a1']);
  });

  it('shows only non-FACES agents when the MINION org is active', () => {
    const out = filterAgentsByOrg(AGENTS, MINION, ORGS).map((a) => a.id);
    expect(out).toEqual(['bj_bot', 'public', 'leiva_bot']);
  });

  it('returns the full list when no active org is set', () => {
    expect(filterAgentsByOrg(AGENTS, null, ORGS)).toHaveLength(AGENTS.length);
    expect(filterAgentsByOrg(AGENTS, undefined, ORGS)).toHaveLength(AGENTS.length);
  });

  it('returns the full list when the org list is empty', () => {
    expect(filterAgentsByOrg(AGENTS, FACES, [])).toHaveLength(AGENTS.length);
  });

  it('does not scope when the active org is neither FACES nor MINION', () => {
    expect(filterAgentsByOrg(AGENTS, 'some-other-org', ORGS)).toHaveLength(AGENTS.length);
  });

  it('hides non-FACES agents in the FACES org even if the MINION org is unresolved', () => {
    const out = filterAgentsByOrg(AGENTS, FACES, [{ id: FACES, slug: 'faces-sculptors' }]).map(
      (a) => a.id,
    );
    expect(out).toEqual(['faces_bot_prd', 'a1']);
  });
});
