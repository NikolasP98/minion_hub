import { describe, expect, it } from 'vitest';
import {
  displayNameOf,
  filterDevUsers,
  groupDevUsersByOrg,
  type DevUserEntry,
} from './dev-user-switcher.logic';

function user(over: Partial<DevUserEntry> & { id: string }): DevUserEntry {
  return {
    email: null,
    displayName: null,
    username: null,
    platformRole: null,
    orgs: [],
    ...over,
  };
}

const owner = user({
  id: 'u-owner',
  displayName: 'Owner Persona',
  email: 'owner@faces.test',
  orgs: [{ orgId: 'org-a', orgName: 'FACES', orgKind: 'business', roleKey: 'owner' }],
});
const viewer = user({
  id: 'u-viewer',
  displayName: 'Viewer Persona',
  email: 'viewer@faces.test',
  orgs: [{ orgId: 'org-a', orgName: 'FACES', orgKind: 'business', roleKey: 'viewer' }],
});
const twoOrgs = user({
  id: 'u-two-orgs',
  displayName: 'Two Orgs Persona',
  email: 'two-orgs@faces.test',
  orgs: [
    { orgId: 'org-b', orgName: 'Acme', orgKind: 'business', roleKey: 'staff' },
    { orgId: 'org-a', orgName: 'FACES', orgKind: 'business', roleKey: 'manager' },
  ],
});
const noOrg = user({ id: 'u-no-org', displayName: 'No Org Persona', email: 'no-org@faces.test' });

describe('filterDevUsers', () => {
  it('returns every user for a blank query', () => {
    expect(filterDevUsers([owner, viewer], '')).toEqual([owner, viewer]);
    expect(filterDevUsers([owner, viewer], '   ')).toEqual([owner, viewer]);
  });

  it('matches case-insensitively across name, email, and username', () => {
    expect(filterDevUsers([owner, viewer], 'OWNER')).toEqual([owner]);
    expect(filterDevUsers([owner, viewer], 'viewer@faces')).toEqual([viewer]);
  });

  it('matches a plain username field', () => {
    const named = user({ id: 'u-x', username: 'quiet.fox', displayName: null, email: null });
    expect(filterDevUsers([named], 'quiet')).toEqual([named]);
  });

  it('excludes users matching none of the fields', () => {
    expect(filterDevUsers([owner, viewer], 'nonexistent')).toEqual([]);
  });
});

describe('groupDevUsersByOrg', () => {
  it('groups users under their primary (first) org, alphabetically by org name', () => {
    const groups = groupDevUsersByOrg([owner, viewer, twoOrgs]);
    expect(groups.map((g) => g.orgName)).toEqual(['Acme', 'FACES']);
    expect(groups.find((g) => g.orgName === 'Acme')?.users).toEqual([twoOrgs]);
    expect(groups.find((g) => g.orgName === 'FACES')?.users).toEqual([owner, viewer]);
  });

  it('puts the no-organization group last regardless of insertion order', () => {
    const groups = groupDevUsersByOrg([noOrg, owner]);
    expect(groups.map((g) => g.orgName)).toEqual(['FACES', null]);
    expect(groups.at(-1)?.users).toEqual([noOrg]);
  });

  it('omits the no-organization group entirely when every user has an org', () => {
    const groups = groupDevUsersByOrg([owner]);
    expect(groups.some((g) => g.orgName === null)).toBe(false);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupDevUsersByOrg([])).toEqual([]);
  });
});

describe('displayNameOf', () => {
  it('prefers displayName, then email, then id', () => {
    expect(displayNameOf(owner)).toBe('Owner Persona');
    expect(displayNameOf(user({ id: 'u-e', email: 'e@x.test' }))).toBe('e@x.test');
    expect(displayNameOf(user({ id: 'u-bare' }))).toBe('u-bare');
  });
});
