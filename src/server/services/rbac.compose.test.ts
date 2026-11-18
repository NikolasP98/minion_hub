import { describe, expect, it } from 'vitest';
import type { OperatorAuthorityRows } from '$server/auth/active-operator-principal';
import {
  buildCapabilities,
  composeFreshCapabilitiesFromAuthorityRows,
  resolveFreshCapabilitiesInTransaction,
} from './rbac.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';

const rows = (over: Partial<OperatorAuthorityRows> = {}): OperatorAuthorityRows => ({
  version: 1,
  orgId: ORG,
  profileId: PROFILE,
  organizationStatus: 'active',
  deletionPending: false,
  roleModel: 'legacy',
  defaultRoleKey: null,
  membershipRole: 'member',
  assignedRoleKeys: ['staff'],
  localRoleKeys: [],
  rules: [],
  authorityRows: [],
  ...over,
});

describe('shared authority composer', () => {
  it('gives legacy-model bridge rows the same capabilities as buildCapabilities', async () => {
    const snap = await composeFreshCapabilitiesFromAuthorityRows(rows(), ORG, PROFILE);
    const expected = buildCapabilities(['staff'], []);
    expect(snap.roles).toEqual(['staff']);
    expect(snap.realRoles).toEqual(['staff']);
    expect(snap.capabilities.can('pos', 'view')).toBe(expected.can('pos', 'view'));
    expect(snap.membershipRole).toBe('member');
  });

  it('keeps only local custom roles under the organization model', async () => {
    const snap = await composeFreshCapabilitiesFromAuthorityRows(
      rows({
        roleModel: 'organization',
        defaultRoleKey: 'custom-a',
        assignedRoleKeys: ['custom-a', 'custom-gone', 'staff'],
        localRoleKeys: ['custom-a'],
      }),
      ORG,
      PROFILE,
    );
    expect(snap.realRoles).toEqual(['custom-a']);
  });

  it('legacy adapter keeps its signature and returns empty authority for a non-member', async () => {
    const tx = { execute: async () => [] } as never;
    const snap = await resolveFreshCapabilitiesInTransaction(tx, ORG, PROFILE);
    expect(snap.membershipRole).toBeNull();
    expect(snap.realRoles).toEqual([]);
  });
});
