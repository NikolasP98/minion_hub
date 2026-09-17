import { describe, test, expect, vi, beforeEach } from 'vitest';

const state: any = {};

// A minimal chainable + thenable query-builder stand-in (mirrors supabase-js's
// PostgrestFilterBuilder): .eq() accumulates AND filters, and the object
// resolves via .single()/.select() or by being awaited directly.
function selectChain() {
  const rows: any[] = state.link ? [state.link] : (state.links ?? []);
  const filters: Array<[string, any]> = [];
  const matches = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
  const chain: any = {
    eq(col: string, val: any) {
      filters.push([col, val]);
      return chain;
    },
    single: async () => {
      const [m] = matches();
      return m ? { data: m, error: null } : { data: null, error: { message: 'none' } };
    },
    then(resolve: any) {
      resolve({ data: matches(), error: null });
    },
  };
  return chain;
}

function updateChain() {
  const rows: any[] = state.links ?? (state.link ? [state.link] : []);
  const filters: Array<[string, any]> = [];
  let usedLt = false;
  const matches = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
  const chain: any = {
    eq(col: string, val: any) {
      filters.push([col, val]);
      return chain;
    },
    lt() {
      usedLt = true; // consumeLink's max-uses guard — driven by state.consumeOk below
      return chain;
    },
    select: async () =>
      usedLt
        ? { data: state.consumeOk ? [{ id: 'l1' }] : [], error: null }
        : { data: matches(), error: null },
    then(resolve: any) {
      resolve({ error: null });
    },
  };
  return chain;
}

vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (row: any) => ({
        select: () => ({ single: async () => ({ data: { id: 'l1', ...row }, error: null }) }),
      }),
      select: () => selectChain(),
      update: () => updateChain(),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({
  createMembership: vi.fn(async () => {
    state.membership = true;
  }),
}));

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k];
});

describe('links.service', () => {
  test('createLink returns token URL', async () => {
    const { createLink } = await import('./links.service');
    const l = await createLink({ organizationId: 'org1', role: 'user', createdBy: 'admin1' });
    expect(l.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('consumeLink rejects unusable link', async () => {
    const { consumeLink } = await import('./links.service');
    state.link = {
      id: 'l1',
      token: 't',
      organization_id: 'org1',
      role: 'user',
      revoked: true,
      expires_at: null,
      max_uses: null,
      uses_count: 0,
    };
    await expect(
      consumeLink('t', { id: 'u1', email: 'a@b.c', displayName: 'A' }),
    ).rejects.toThrow();
    expect(state.membership).toBeUndefined();
  });

  test("listLinks(orgId) returns only that org's active links (D4 org filter)", async () => {
    const { listLinks } = await import('./links.service');
    state.links = [
      { id: 'l1', organization_id: 'org1', revoked: false },
      { id: 'l2', organization_id: 'org2', revoked: false },
    ];
    const result = await listLinks('org1');
    expect(result.map((r: any) => r.id)).toEqual(['l1']);
  });

  test('listLinks() with no org returns every active link (unscoped internal use)', async () => {
    const { listLinks } = await import('./links.service');
    state.links = [
      { id: 'l1', organization_id: 'org1', revoked: false },
      { id: 'l2', organization_id: 'org2', revoked: false },
    ];
    const result = await listLinks();
    expect(result.map((r: any) => r.id).sort()).toEqual(['l1', 'l2']);
  });

  test('revokeLink(id, orgId) revokes a link belonging to that org', async () => {
    const { revokeLink } = await import('./links.service');
    state.links = [{ id: 'l1', organization_id: 'org1', revoked: false }];
    await expect(revokeLink('l1', 'org1')).resolves.toBe(true);
  });

  test("revokeLink(id, orgId) is a no-op (false) for another org's link", async () => {
    const { revokeLink } = await import('./links.service');
    state.links = [{ id: 'l1', organization_id: 'org2', revoked: false }];
    await expect(revokeLink('l1', 'org1')).resolves.toBe(false);
  });
});
