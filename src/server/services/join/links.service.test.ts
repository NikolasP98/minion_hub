import { describe, test, expect, vi, beforeEach } from 'vitest';

const state: any = {};
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (row: any) => ({ select: () => ({ single: async () => ({ data: { id: 'l1', ...row }, error: null }) }) }),
      select: () => ({ eq: () => ({ single: async () => ({ data: state.link ?? null, error: state.link ? null : { message: 'none' } }) }) }),
      update: (_patch: any) => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: state.consumeOk ? [{ id: 'l1' }] : [], error: null }) }) }), }),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({ createMembership: vi.fn(async () => { state.membership = true; }) }));

beforeEach(() => { for (const k of Object.keys(state)) delete state[k]; });

describe('links.service', () => {
  test('createLink returns token URL', async () => {
    const { createLink } = await import('./links.service');
    const l = await createLink({ organizationId: 'org1', role: 'user', createdBy: 'admin1' });
    expect(l.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('consumeLink rejects unusable link', async () => {
    const { consumeLink } = await import('./links.service');
    state.link = { id: 'l1', token: 't', organization_id: 'org1', role: 'user', revoked: true, expires_at: null, max_uses: null, uses_count: 0 };
    await expect(consumeLink('t', { id: 'u1', email: 'a@b.c', displayName: 'A' })).rejects.toThrow();
    expect(state.membership).toBeUndefined();
  });
});
