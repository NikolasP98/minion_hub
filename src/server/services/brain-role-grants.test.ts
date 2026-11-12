import { describe, expect, it } from 'vitest';
import { buildCapabilities } from './rbac.service';
import {
  assertRoleBrainGrantCeiling,
  assertRecipientBrainGrantCeiling,
  roleBrainGrantRevision,
  ROLE_BRAIN_LIMITS,
  type BrainRoleGrantSnapshot,
} from './brain-role-grants';
const caps = (
  patch: Partial<{
    view: boolean;
    edit: boolean;
    delete: boolean;
    export: boolean;
    manage: boolean;
    owner: boolean;
  }> = {},
) =>
  buildCapabilities(
    ['custom-role'],
    [
      {
        role_key: 'custom-role',
        module: 'brains',
        can_view: patch.view ?? true,
        can_create: true,
        can_edit: patch.edit ?? true,
        can_delete: patch.delete ?? true,
        can_export: patch.export ?? true,
        can_manage: patch.manage ?? false,
        if_owner: patch.owner ?? false,
        field_level: 0,
      },
    ],
  );
const snapshot = (level = 'write'): BrainRoleGrantSnapshot => ({
  brains: [{ id: 'private-b', created_by: null, visibility: 'private' }],
  access: [{ brain_id: 'private-b', principal_type: 'role', principal_id: 'custom-target', level }],
});
const actor = (permissions = caps()) => ({
  profileId: 'grantor',
  roles: ['custom-actor'],
  caps: permissions,
});
const selected = { roles: ['custom-target'], caps: caps() };
const hidden = caps({ view: false, edit: false, delete: false, export: false, manage: false });
describe('Brain authority carried by role grants', () => {
  it.each(['legacy', 'organization'] as const)(
    'requires the same future-private scope in %s even with no current assets',
    (roleModel) => {
      const target =
        roleModel === 'legacy'
          ? { roles: ['admin'], caps: caps() }
          : { roles: ['custom-admin'], caps: caps({ manage: true }) };
      expect(() =>
        assertRoleBrainGrantCeiling({
          roleModel,
          snapshot: { brains: [], access: [] },
          actual: actor(caps({ manage: roleModel === 'legacy' })),
          selected: target,
        }),
      ).toThrow();
    },
  );
  it('does not let an actual legacy Administrator lend its bypass to a custom-role simulation', () => {
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'legacy',
        snapshot: { brains: [], access: [] },
        actual: { ...actor(), roles: ['admin'] },
        effective: actor(),
        selected: { roles: ['admin'], caps: caps() },
      }),
    ).toThrow();
  });
  it("permits a private read ACL through the grantor's organization visibility without inventing write access", () => {
    const state = snapshot('read');
    state.brains[0].visibility = 'org';
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        selected,
      }),
    ).not.toThrow();
    const writeState = {
      ...state,
      access: state.access.map((row) => ({ ...row, level: 'write' })),
    };
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: writeState,
        actual: actor(),
        selected,
      }),
    ).toThrow();
  });
  it('denies a latent role write ACL even when the granted role hides Brains', () => {
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: snapshot(),
        actual: actor(),
        selected: { roles: ['custom-target'], caps: hidden },
      }),
    ).toThrow();
  });
  it("requires object ownership when the grantor's module is owner scoped", () => {
    const state = snapshot();
    state.access.push({
      brain_id: 'private-b',
      principal_type: 'user',
      principal_id: 'grantor',
      level: 'write',
    });
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(caps({ owner: true })),
        selected,
      }),
    ).toThrow();
  });
  it('treats adding delete as a new private-object action despite an unchanged write ACL', () => {
    const state = snapshot();
    state.access.push({
      brain_id: 'private-b',
      principal_type: 'user',
      principal_id: 'grantor',
      level: 'read',
    });
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        previous: { roles: ['custom-target'], caps: caps({ delete: false }) },
        selected,
      }),
    ).toThrow();
  });
  it("allows true narrowing while retained private ACLs remain outside the editor's scope", () => {
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: snapshot(),
        actual: actor(),
        previous: selected,
        selected: { roles: ['custom-target'], caps: caps({ delete: false }) },
      }),
    ).not.toThrow();
  });
  it('hashes exact selected role ACL scopes and levels independently of actor grants and row order', () => {
    const state = snapshot();
    state.access.push({
      brain_id: 'private-b',
      principal_type: 'user',
      principal_id: 'grantor',
      level: 'write',
    });
    const hash = roleBrainGrantRevision({ roleModel: 'organization', snapshot: state, selected });
    expect(
      roleBrainGrantRevision({
        roleModel: 'organization',
        snapshot: { ...state, access: [...state.access].reverse() },
        selected,
      }),
    ).toBe(hash);
    expect(
      roleBrainGrantRevision({
        roleModel: 'organization',
        snapshot: { ...state, access: state.access.filter((row) => row.principal_type === 'role') },
        selected,
      }),
    ).toBe(hash);
    expect(
      roleBrainGrantRevision({ roleModel: 'organization', snapshot: snapshot('read'), selected }),
    ).not.toBe(hash);
  });
});
describe('recipient Brain authority activation', () => {
  it.each(['user', 'creator'] as const)(
    'rejects activation of private %s rights the grantor lacks',
    (kind) => {
      const state = snapshot();
      state.access = [];
      if (kind === 'creator') state.brains[0].created_by = 'recipient';
      else
        state.access.push({
          brain_id: 'private-b',
          principal_type: 'user',
          principal_id: 'recipient',
          level: 'write',
        });
      expect(() =>
        assertRecipientBrainGrantCeiling({
          roleModel: 'organization',
          snapshot: state,
          actual: actor(),
          before: { profileId: 'recipient', active: true, roles: ['custom-hidden'], caps: hidden },
          after: { profileId: 'recipient', active: true, ...selected },
        }),
      ).toThrow();
    },
  );
  it('does not restore retained user ACLs simply because membership was inactive', () => {
    const state = snapshot();
    state.access = [
      { brain_id: 'private-b', principal_type: 'user', principal_id: 'recipient', level: 'write' },
    ];
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        before: { profileId: 'recipient', active: false, ...selected },
        after: { profileId: 'recipient', active: true, ...selected },
      }),
    ).toThrow();
  });
  it('requires the simulated actor to hold each newly restored object action', () => {
    const state = snapshot();
    state.access.push({
      brain_id: 'private-b',
      principal_type: 'user',
      principal_id: 'grantor',
      level: 'write',
    });
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        effective: actor(caps({ edit: false, delete: false })),
        before: { profileId: 'recipient', active: false, ...selected },
        after: { profileId: 'recipient', active: true, ...selected },
      }),
    ).toThrow();
  });
  it('keeps narrowing available when no recipient object actions are added', () => {
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: snapshot(),
        actual: actor(),
        before: { profileId: 'recipient', active: true, ...selected },
        after: { profileId: 'recipient', active: true, roles: ['custom-target'], caps: hidden },
      }),
    ).not.toThrow();
  });
  it.each([false, true])(
    'checks case-folded owned-agent write activation with grantor-held scope=%s',
    (held) => {
      const state = snapshot();
      state.access = [
        {
          brain_id: 'private-b',
          principal_type: 'agent',
          principal_id: 'personal-member',
          level: 'write',
        },
      ];
      state.personalAgents = [{ profile_id: 'recipient', agent_id: 'Personal-Member' }];
      if (held)
        state.access.push({
          brain_id: 'private-b',
          principal_type: 'user',
          principal_id: 'grantor',
          level: 'write',
        });
      const check = () =>
        assertRecipientBrainGrantCeiling({
          roleModel: 'organization',
          snapshot: state,
          actual: actor(),
          before: { profileId: 'recipient', active: true, roles: [], caps: hidden },
          after: { profileId: 'recipient', active: true, ...selected },
        });
      if (held) expect(check).not.toThrow();
      else expect(check).toThrow();
    },
  );
  it("does not treat a different profile's personal agent as the recipient", () => {
    const state = snapshot();
    state.access = [
      {
        brain_id: 'private-b',
        principal_type: 'agent',
        principal_id: 'foreign-agent',
        level: 'write',
      },
    ];
    state.personalAgents = [{ profile_id: 'other', agent_id: 'foreign-agent' }];
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        before: { profileId: 'recipient', active: true, roles: [], caps: hidden },
        after: { profileId: 'recipient', active: true, ...selected },
      }),
    ).not.toThrow();
  });
  it.each([
    { id: 'brain-00000000-0000-4000-8000-000000000001', managed: true },
    { id: 'brain-legacy', managed: false },
  ])('matches the real managed-Brain classification for $id', ({ id, managed }) => {
    const state = snapshot();
    state.access = [
      { brain_id: 'private-b', principal_type: 'agent', principal_id: id, level: 'write' },
    ];
    state.personalAgents = [{ profile_id: 'recipient', agent_id: id }];
    const check = () =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        before: { profileId: 'recipient', active: true, roles: [], caps: hidden },
        after: { profileId: 'recipient', active: true, ...selected },
      });
    if (managed) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
  it('rejects ambiguous case-folded personal-agent ownership', () => {
    const state = snapshot();
    state.access = [
      {
        brain_id: 'private-b',
        principal_type: 'agent',
        principal_id: 'personal-member',
        level: 'write',
      },
    ];
    state.personalAgents = [
      { profile_id: 'recipient', agent_id: 'Personal-Member' },
      { profile_id: 'other', agent_id: 'personal-member' },
    ];
    try {
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        before: { profileId: 'recipient', active: false, ...selected },
        after: { profileId: 'recipient', active: true, ...selected },
      });
      throw Error('Ambiguous binding was accepted');
    } catch (error) {
      expect(error).toMatchObject({ status: 503 });
    }
  });
  it('never lends a grantor private rights through their own personal agent', () => {
    const state = snapshot();
    state.access.push({
      brain_id: 'private-b',
      principal_type: 'agent',
      principal_id: 'grantor-agent',
      level: 'write',
    });
    state.personalAgents = [{ profile_id: 'grantor', agent_id: 'grantor-agent' }];
    expect(() =>
      assertRoleBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: actor(),
        selected,
      }),
    ).toThrow();
  });
  it('partitions browser and recipient caches even when the same identity object is reused', () => {
    const state = snapshot();
    state.access = [
      {
        brain_id: 'private-b',
        principal_type: 'agent',
        principal_id: 'grantor-agent',
        level: 'write',
      },
    ];
    state.personalAgents = [{ profile_id: 'grantor', agent_id: 'grantor-agent' }];
    const identity = { ...actor(), active: true };
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual: identity,
        before: { ...identity, active: false },
        after: identity,
      }),
    ).toThrow();
  });
  it('fails closed at the shared recipient bound without silently truncating evaluation', () => {
    const state: BrainRoleGrantSnapshot = { brains: [], access: [] },
      actual = actor(),
      recipient = { profileId: 'recipient', active: false, roles: [], caps: hidden };
    for (let i = 0; i < ROLE_BRAIN_LIMITS.policyRecipients; i++)
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual,
        before: recipient,
        after: recipient,
      });
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual,
        before: recipient,
        after: recipient,
      }),
    ).toThrow();
  });
  it('fails closed on excessive aggregate Brain evaluation work even below the recipient bound', () => {
    const state: BrainRoleGrantSnapshot = {
      brains: Array.from({ length: ROLE_BRAIN_LIMITS.brains }, (_, id) => ({
        id: String(id),
        created_by: null,
        visibility: 'private',
      })),
      access: [],
    };
    const actual = actor(),
      recipient = { profileId: 'recipient', active: false, roles: [], caps: hidden };
    const accepted = Math.floor(ROLE_BRAIN_LIMITS.policyEvaluatedCells / ROLE_BRAIN_LIMITS.brains);
    for (let i = 0; i < accepted; i++)
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual,
        before: recipient,
        after: recipient,
      });
    expect(() =>
      assertRecipientBrainGrantCeiling({
        roleModel: 'organization',
        snapshot: state,
        actual,
        before: recipient,
        after: recipient,
      }),
    ).toThrow();
  });
});
