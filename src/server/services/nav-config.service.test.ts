import { describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({
  value: {
    version: 1,
    sections: [
      {
        id: 'st4ff1',
        slug: 'staff',
        label: 'Staff',
        pages: [{ id: 'k3x9q2', kind: 'link', slug: 'sell', label: 'Sell', target: '/pos/sell' }],
      },
    ],
    builtinSections: {},
    builtin: {},
  },
}));

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: unknown, _o: unknown, fn: () => unknown) => fn(),
  invalidateTags: vi.fn(),
  keys: { hub: () => 'k' },
  tags: { tenantDomain: () => 't' },
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_c: unknown, fn: (tx: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [stored] }) }) }) }),
}));
vi.mock('$server/db/pg-schema/nav-config', () => ({ appNavConfig: {} }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

const { isPageRuleKey } = await import('./nav-config.service');
const ctx = { tenantId: 'org-a' } as never;

describe('isPageRuleKey', () => {
  it.each([
    ['page:k3x9q2', true],
    ['section:st4ff1', true],
    ['page:/pos/sell', true],
    ['page:zzzzzz', false],
    ['section:zzzzzz', false],
    ['page:/nope', false],
    ['page:/pos/sell/../x', false],
    ['crm', false],
    ['crm.insights', false],
    ['page:', false],
    ['page:K3X9Q2', false],
  ])('%s -> %s', async (key, ok) => {
    expect(await isPageRuleKey(ctx, key)).toBe(ok);
  });
});
