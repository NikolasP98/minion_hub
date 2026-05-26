import { describe, test, expect, vi, beforeEach } from 'vitest';

const calls: any = {};
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: any) => ({ select: () => ({ single: async () => ((calls.inserted = row), { data: { id: 'r1', ...row }, error: null }) }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: calls.pending ?? null, error: null }) }) }),
        in: () => ({ data: calls.admins ?? [], error: null }),
      }),
      update: (patch: any) => ({ eq: () => ({ select: () => ({ single: async () => ((calls.updated = patch), { data: { id: 'r1', ...calls.row, ...patch }, error: null }) }) }) }),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({ createMembership: vi.fn(async () => { calls.membership = true; }) }));
vi.mock('$server/services/email.service', () => ({ sendJoinRequestEmail: vi.fn(async () => { calls.email = true; }) }));

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe('requests.service', () => {
  test('createRequest inserts pending + emails admins', async () => {
    const { createRequest } = await import('./requests.service');
    calls.admins = [{ email: 'admin@x.io', role: 'admin' }];
    const r = await createRequest({ id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' }, 'org1', 'hello');
    expect(calls.inserted.status).toBe('pending');
    expect(calls.email).toBe(true);
    expect(r.id).toBe('r1');
  });

  test('approve creates membership + marks approved', async () => {
    const { approveRequest } = await import('./requests.service');
    calls.row = { user_id: 'u1', email: 'a@b.c', display_name: 'A', organization_id: 'org1' };
    await approveRequest('r1', { reviewerId: 'admin1', role: 'user', organizationId: 'org1' });
    expect(calls.membership).toBe(true);
    expect(calls.updated.status).toBe('approved');
  });
});
