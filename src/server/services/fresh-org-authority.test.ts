import { describe, expect, it } from 'vitest';
import type { CapabilityOverrideRow } from './rbac.service';
import {
  buildFreshOrgAuthorizedMembers,
  FreshOrgAuthorityOverflow,
  type FreshOrgAuthorityRow,
} from './fresh-org-authority';

const row = (overrides: Partial<FreshOrgAuthorityRow> = {}): FreshOrgAuthorityRow => ({
  profile_id: '00000000-0000-4000-8000-000000000001',
  legacy_role: 'member',
  profile_role: 'user',
  auth_email: 'Member@Example.Test',
  email_confirmed_at: new Date('2026-10-03T00:00:00Z'),
  role_key: null,
  ...overrides,
});

const rule = (overrides: Partial<CapabilityOverrideRow> = {}): CapabilityOverrideRow => ({
  role_key: 'custom-user-manager',
  module: 'users',
  can_view: true,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_export: false,
  can_manage: true,
  ...overrides,
});

describe('fresh organization capability projection', () => {
  it('uses current member roles and the canonical capability builder', () => {
    const members = buildFreshOrgAuthorizedMembers(
      [row({ role_key: 'custom-user-manager' })],
      [rule()],
      'users',
      'manage',
    );
    expect(members).toEqual([
      {
        profileId: '00000000-0000-4000-8000-000000000001',
        verifiedEmail: 'member@example.test',
      },
    ]);
  });

  it('checks profile global-admin semantics only for rows already in the member set', () => {
    expect(
      buildFreshOrgAuthorizedMembers(
        [row({ profile_role: 'admin', legacy_role: 'viewer' })],
        [],
        'users',
        'manage',
      ),
    ).toHaveLength(1);
    expect(buildFreshOrgAuthorizedMembers([], [], 'users', 'manage')).toEqual([]);
  });

  it('denies the legacy manager default and accepts an explicit admin legacy role', () => {
    expect(
      buildFreshOrgAuthorizedMembers([row({ legacy_role: 'member' })], [], 'users', 'manage'),
    ).toEqual([]);
    expect(
      buildFreshOrgAuthorizedMembers([row({ legacy_role: 'admin' })], [], 'users', 'manage'),
    ).toHaveLength(1);
  });

  it('never substitutes profiles.email for missing or unconfirmed auth email', () => {
    const [member] = buildFreshOrgAuthorizedMembers(
      [
        row({
          legacy_role: 'admin',
          auth_email: 'profile-fallback@example.test',
          email_confirmed_at: null,
        }),
      ],
      [],
      'users',
      'manage',
    );
    expect(member?.verifiedEmail).toBeNull();
  });

  it('rejects limit-plus-one before audience filtering', () => {
    const rows = Array.from({ length: 1001 }, (_, index) =>
      row({
        profile_id: `00000000-0000-4000-8${String(index).padStart(3, '0')}-000000000001`,
        legacy_role: 'viewer',
      }),
    );
    expect(() => buildFreshOrgAuthorizedMembers(rows, [], 'users', 'manage')).toThrow(
      FreshOrgAuthorityOverflow,
    );
  });
});
