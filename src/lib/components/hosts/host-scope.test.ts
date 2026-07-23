import { describe, it, expect } from 'vitest';
import { scopeHostsToOrg } from './host-scope';
import type { LabelHost } from './host-label';

const FLEET: LabelHost[] = [
  { id: 'a', name: 'netcup-prd', orgId: 'org-mini' },
  { id: 'b', name: 'netcup-faces-prd', orgId: 'org-faces' },
  { id: 'c', name: 'netcup-prd', orgId: 'org-pino' },
  { id: 'd', name: 'protopi-dev', orgId: 'org-mini' },
  { id: 'e', name: 'protopi-dev', orgId: 'org-pino' },
  { id: 'shared', name: 'pool-gw', orgId: null },
];

describe('scopeHostsToOrg', () => {
  it('shows only the active org, plus unassigned shared hosts', () => {
    expect(scopeHostsToOrg(FLEET, 'org-pino').map((h) => h.id)).toEqual(['c', 'e', 'shared']);
  });

  it('removes the duplicate names that made the picker ambiguous', () => {
    const names = scopeHostsToOrg(FLEET, 'org-pino').map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the active host visible even when it belongs to another org', () => {
    // else the pill would name a gateway missing from its own dropdown
    expect(scopeHostsToOrg(FLEET, 'org-pino', 'b').map((h) => h.id)).toContain('b');
  });

  it('an org with no gateway of its own still sees the shared pool', () => {
    expect(scopeHostsToOrg(FLEET, 'org-with-no-gateway').map((h) => h.id)).toEqual(['shared']);
  });

  it('falls back to every host rather than emptying the picker', () => {
    const orgOnly = FLEET.filter((h) => h.orgId); // no shared host to fall back on
    expect(scopeHostsToOrg(orgOnly, 'org-with-no-gateway').map((h) => h.id)).toEqual(
      orgOnly.map((h) => h.id),
    );
  });

  it('is a no-op with no active org', () => {
    expect(scopeHostsToOrg(FLEET, null)).toHaveLength(FLEET.length);
  });
});
