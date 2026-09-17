import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  from: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: (locals: { user?: unknown }) => {
    if (!locals.user) throw { status: 401 };
    return locals.user;
  },
}));

vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({ auth: { admin: { listUsers: mocks.listUsers } }, from: mocks.from }),
}));

import { GET } from './+server';

function callGET(locals: unknown) {
  return GET({ locals } as unknown as Parameters<typeof GET>[0]);
}

function table(rows: unknown[]) {
  return { select: () => ({ in: async () => ({ data: rows, error: null }) }) };
}

const ORG_A = { id: 'org-a', name: 'Alpha Org', kind: 'business' };
const ORG_B = { id: 'org-b', name: 'Beta Org', kind: 'business' };

function mockTables(opts: {
  profiles?: unknown[];
  memberRoles?: unknown[];
  legacyMembers?: unknown[];
  orgs?: unknown[];
}) {
  mocks.from.mockImplementation((name: string) => {
    if (name === 'profiles') return table(opts.profiles ?? []);
    if (name === 'member_roles') return table(opts.memberRoles ?? []);
    if (name === 'organization_members') return table(opts.legacyMembers ?? []);
    if (name === 'organizations') {
      // organizations is fetched with .select() only (no .in())
      return { select: async () => ({ data: opts.orgs ?? [], error: null }) };
    }
    throw new Error(`unexpected table ${name}`);
  });
}

describe('GET /api/dev/users', () => {
  it('404s when not on the DEV backend', async () => {
    await expect(callGET({ backend: 'prd', user: { id: 'u1' } })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('401s when unauthenticated', async () => {
    await expect(callGET({ backend: 'dev' })).rejects.toMatchObject({ status: 401 });
  });

  it('returns an empty list with no GoTrue users', async () => {
    mocks.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
    const res = await callGET({ backend: 'dev', user: { id: 'caller' } });
    expect(await res.json()).toEqual({ users: [] });
  });

  it('groups by org and sorts by org name, then role rank, then display name', async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: 'u-owner', email: 'owner@qa.test' },
          { id: 'u-staff', email: 'staff@qa.test' },
          { id: 'u-beta-admin', email: 'beta-admin@qa.test' },
          { id: 'u-noorg', email: 'noorg@qa.test' },
        ],
      },
      error: null,
    });
    mockTables({
      profiles: [
        { id: 'u-owner', display_name: 'Zed Owner', username: null, role: 'user' },
        { id: 'u-staff', display_name: 'Ann Staff', username: null, role: 'user' },
        { id: 'u-beta-admin', display_name: 'Beta Admin', username: null, role: 'user' },
        { id: 'u-noorg', display_name: 'No Org', username: null, role: 'user' },
      ],
      memberRoles: [
        { org_id: ORG_A.id, profile_id: 'u-owner', role_key: 'owner' },
        { org_id: ORG_A.id, profile_id: 'u-staff', role_key: 'staff' },
        { org_id: ORG_B.id, profile_id: 'u-beta-admin', role_key: 'admin' },
      ],
      orgs: [ORG_A, ORG_B],
    });

    const res = await callGET({ backend: 'dev', user: { id: 'caller' } });
    const body = (await res.json()) as { users: Array<{ id: string }> };
    // Alpha Org (owner rank 0, then staff rank 3) before Beta Org, no-org last.
    expect(body.users.map((u) => u.id)).toEqual(['u-owner', 'u-staff', 'u-beta-admin', 'u-noorg']);
  });

  it('falls back to the legacy organization_members role when no member_roles row exists', async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'u-legacy', email: 'legacy@qa.test' }] },
      error: null,
    });
    mockTables({
      profiles: [{ id: 'u-legacy', display_name: 'Legacy Member', username: null, role: 'user' }],
      legacyMembers: [{ organization_id: ORG_A.id, profile_id: 'u-legacy', role: 'member' }],
      orgs: [ORG_A],
    });

    const res = await callGET({ backend: 'dev', user: { id: 'caller' } });
    const body = (await res.json()) as {
      users: Array<{ id: string; orgs: Array<{ roleKey: string }> }>;
    };
    expect(body.users[0].orgs).toEqual([
      { orgId: ORG_A.id, orgName: ORG_A.name, orgKind: ORG_A.kind, roleKey: 'manager' },
    ]);
  });

  it('includes users with zero orgs (the no-org persona reaching /join)', async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'u-noorg', email: 'noorg@qa.test' }] },
      error: null,
    });
    mockTables({
      profiles: [{ id: 'u-noorg', display_name: 'No Org', username: null, role: 'user' }],
    });

    const res = await callGET({ backend: 'dev', user: { id: 'caller' } });
    const body = (await res.json()) as { users: Array<{ id: string; orgs: unknown[] }> };
    expect(body.users).toEqual([
      {
        id: 'u-noorg',
        email: 'noorg@qa.test',
        displayName: 'No Org',
        username: null,
        platformRole: 'user',
        orgs: [],
      },
    ]);
  });
});
