import { describe, expect, it } from 'vitest';
import {
  resolveManagerRecipients,
  type AuthorityMemberRow,
  type AuthorityRuleRow,
} from './authority';

const OWNER = '10000000-0000-4000-8000-000000000001';
const MANAGER = '10000000-0000-4000-8000-000000000002';
const CUSTOM = '10000000-0000-4000-8000-000000000003';

function member(
  profileId: string,
  legacyRole: string,
  roleKey: string | null = null,
  profileRole: string | null = 'user',
): AuthorityMemberRow {
  return { profileId, legacyRole, profileRole, roleKey };
}

function rule(roleKey: string, canManage: boolean, fieldLevel = 0): AuthorityRuleRow {
  return {
    role_key: roleKey,
    module: 'users',
    can_manage: canManage,
    if_owner: false,
    field_level: fieldLevel,
  };
}

describe('notification projection authority', () => {
  it('uses explicit roles before legacy fallback and applies the canonical users:manage override', () => {
    const recipients = resolveManagerRecipients(
      [
        member(OWNER, 'owner'),
        member(MANAGER, 'member'),
        member(CUSTOM, 'owner', 'custom-reviewer'),
      ],
      [rule('custom-reviewer', true), rule('manager', false)],
    );
    expect(recipients.map((row) => row.profileId)).toEqual([OWNER, CUSTOM]);
    const custom = recipients.find((row) => row.profileId === CUSTOM);
    expect(custom?.evidence).toContain('custom-reviewer');
    expect(custom?.evidence).not.toContain('manager');
  });

  it('binds only rules relevant to each recipient and preserves profile-admin authority', () => {
    const recipients = resolveManagerRecipients(
      [member(OWNER, 'owner'), member(MANAGER, 'member', null, 'admin')],
      [rule('owner', true, 1), rule('custom-unused', true, 7)],
    );
    expect(recipients).toHaveLength(2);
    expect(recipients.every((row) => !row.evidence.includes('custom-unused'))).toBe(true);
    expect(recipients.find((row) => row.profileId === MANAGER)?.evidence).toContain(
      '"profileAdmin":true',
    );
  });
});
