import { describe, it, expect, vi } from 'vitest';
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: () => {
    throw new Error('No database in policy unit tests');
  },
}));
import { parseOrganizationRolePolicy, rolePolicyRevision } from './organization-role-policy';
import { resolveMemberRoleKeys } from './rbac.service';
import { getRoleTemplate, templateCaps } from './role-templates';

describe('organization-owned role policy', () => {
  it('preserves the pre-migration legacy model but rejects unknown metadata', () => {
    expect(parseOrganizationRolePolicy({})).toEqual({ roleModel: 'legacy', defaultRoleKey: null });
    expect(() => parseOrganizationRolePolicy(null)).toThrow('unavailable');
    expect(() => parseOrganizationRolePolicy({ role_model: 'invented' })).toThrow('Unknown');
    expect(() => parseOrganizationRolePolicy({ role_model: 'organization' })).toThrow('default');
  });
  it('never lets new-model ownership or a global key substitute for an explicit local assignment', () => {
    expect(resolveMemberRoleKeys([], 'owner', 'organization', ['custom-admin'])).toEqual([]);
    expect(resolveMemberRoleKeys(['admin'], 'owner', 'organization', ['admin'])).toEqual([]);
    expect(
      resolveMemberRoleKeys(['custom-foreign'], 'member', 'organization', ['custom-admin']),
    ).toEqual([]);
    expect(
      resolveMemberRoleKeys(['custom-admin', 'custom-admin'], 'member', 'organization', [
        'custom-admin',
      ]),
    ).toEqual(['custom-admin']);
    expect(resolveMemberRoleKeys([], 'member')).toEqual(['manager']);
  });
  it('freezes named versioned templates without accepting ownership as a template', () => {
    expect(getRoleTemplate('admin')).toMatchObject({ name: 'Administrator', version: 1, rank: 80 });
    expect(() => getRoleTemplate('owner')).toThrow();
    expect(() => getRoleTemplate('staff', 2)).toThrow();
    expect(templateCaps('staff', 'crm')).toMatchObject({
      view: true,
      create: true,
      edit: true,
      delete: false,
      manage: false,
    });
    expect(templateCaps('admin', 'users')).toMatchObject({ view: true, manage: true });
    expect(templateCaps('manager', 'roles')).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: true,
      export: false,
      manage: false,
    });
    expect(templateCaps('staff', 'roles')).toMatchObject({
      view: false,
      create: false,
      edit: false,
      delete: false,
    });
    expect(templateCaps('viewer', 'roles')).toMatchObject({
      view: false,
      create: false,
      edit: false,
      delete: false,
    });
  });
  it('revisions ignore database row ordering and include role-model/default changes', () => {
    const policy = { roleModel: 'organization' as const, defaultRoleKey: 'custom-admin' };
    const roles = [
        { key: 'custom-admin', rank: 80 },
        { key: 'custom-viewer', rank: 10 },
      ],
      rules = [
        { module: 'crm', can_view: true },
        { module: 'users', can_manage: true },
      ];
    expect(rolePolicyRevision(policy, roles, rules)).toEqual(
      rolePolicyRevision(policy, [...roles].reverse(), [...rules].reverse()),
    );
    expect(rolePolicyRevision(policy, roles, rules)).not.toEqual(
      rolePolicyRevision({ ...policy, defaultRoleKey: 'custom-viewer' }, roles, rules),
    );
  });
});
