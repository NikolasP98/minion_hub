import { describe, test, expect, vi, beforeEach } from 'vitest';

type Link = { id: string; organization_id: string; revoked: boolean };
const state = vi.hoisted(() => ({
  links: [] as Link[],
  mint: vi.fn(),
  consume: vi.fn(),
}));
vi.mock('./organization-admission', () => ({
  mintOrganizationInvite: state.mint,
  consumeOrganizationInvite: state.consume,
}));
function query() {
  const filters: Array<[string, unknown]> = [];
  const result = () =>
    state.links.filter((row) => filters.every(([key, value]) => row[key as keyof Link] === value));
  interface Query extends PromiseLike<{ data: Link[]; error: null }> {
    eq(key: string, value: unknown): Query;
    select(): Promise<{ data: Link[]; error: null }>;
  }
  const chain: Query = {
    eq(key, value) {
      filters.push([key, value]);
      return chain;
    },
    select: async () => ({ data: result(), error: null }),
    then(resolve, reject) {
      return Promise.resolve({ data: result(), error: null }).then(resolve, reject);
    },
  };
  return chain;
}
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: query, update: query }) }),
}));
import { createLink, consumeLink, listLinks, revokeLink } from './links.service';
beforeEach(() => {
  state.links = [];
  state.mint.mockReset().mockResolvedValue({ id: 'l1', token: 'verified-token' });
  state.consume.mockReset().mockResolvedValue({ organizationId: 'org1' });
});
describe('links.service', () => {
  test('mints legacy and local roles through the verified atomic grant boundary', async () => {
    const opts = {
      organizationId: 'org1',
      role: 'staff',
      createdBy: 'user1',
      grantorProfileId: 'profile1',
    };
    await expect(createLink(opts)).resolves.toEqual({ id: 'l1', token: 'verified-token' });
    expect(state.mint).toHaveBeenCalledWith(opts);
  });
  test('rejects a mint without the authenticated grantor profile', async () => {
    await expect(
      createLink({ organizationId: 'org1', role: 'admin', createdBy: 'user1' }),
    ).rejects.toThrow('Authenticated grantor profile required');
    expect(state.mint).not.toHaveBeenCalled();
  });
  test('delegates redemption to the transaction that verifies grants and consumes a use', async () => {
    const user = {
      id: 'user1',
      email: 'applicant@example.test',
      displayName: null,
      supabaseId: 'profile1',
    };
    await expect(consumeLink('verified-token', user)).resolves.toEqual({ organizationId: 'org1' });
    expect(state.consume).toHaveBeenCalledWith('verified-token', user);
  });
  test('preserves a failed grant check without claiming membership admission', async () => {
    state.consume.mockRejectedValueOnce(new Error('Role exceeds the grantor authority'));
    await expect(
      consumeLink('verified-token', {
        id: 'user1',
        email: 'applicant@example.test',
        displayName: null,
        supabaseId: 'profile1',
      }),
    ).rejects.toThrow('Role exceeds the grantor authority');
  });
  test("listLinks(orgId) returns only that org's active links (D4 org filter)", async () => {
    state.links = [
      { id: 'l1', organization_id: 'org1', revoked: false },
      { id: 'l2', organization_id: 'org2', revoked: false },
    ];
    expect((await listLinks('org1')).map((row) => row.id)).toEqual(['l1']);
  });
  test('listLinks() preserves the internal unscoped read', async () => {
    state.links = [
      { id: 'l1', organization_id: 'org1', revoked: false },
      { id: 'l2', organization_id: 'org2', revoked: false },
    ];
    expect((await listLinks()).map((row) => row.id)).toEqual(['l1', 'l2']);
  });
  test('revokeLink scopes the mutation to the target organization', async () => {
    state.links = [{ id: 'l1', organization_id: 'org1', revoked: false }];
    await expect(revokeLink('l1', 'org1')).resolves.toBe(true);
    await expect(revokeLink('l1', 'org2')).resolves.toBe(false);
  });
});
