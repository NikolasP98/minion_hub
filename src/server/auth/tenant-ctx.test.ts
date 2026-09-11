import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ org: vi.fn(), db: vi.fn(), usage: vi.fn() }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: mocks.org }));
vi.mock('$server/db/client', () => ({ getDb: mocks.db }));
vi.mock('$server/ai-usage', () => ({ setAiUsageOrg: mocks.usage }));
import { getTenantCtx, getOrCreateTenantCtx } from './tenant-ctx';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.org.mockReturnValue({
    from: () => ({
      select: () => ({
        limit: () => ({ maybeSingle: async () => ({ data: { id: 'foreign-org' } }) }),
      }),
    }),
  });
});
it.each([
  {},
  { orgId: 'unverified-org' },
  { user: { id: 'user', email: '', displayName: null, role: 'admin' as const } },
])('never infers a tenant from unresolved locals %j', async (locals) => {
  expect(await getTenantCtx(locals)).toBeNull();
  await expect(getOrCreateTenantCtx(locals)).rejects.toMatchObject({ status: 403 });
  expect(mocks.org).not.toHaveBeenCalled();
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.usage).not.toHaveBeenCalled();
});
it('preserves only the explicit resolved context and usage attribution', async () => {
  const ctx = { db: {} as never, tenantId: 'resolved-org' };
  expect(await getTenantCtx({ tenantCtx: ctx })).toBe(ctx);
  expect(mocks.usage).toHaveBeenCalledWith(ctx.tenantId);
  expect(mocks.org).not.toHaveBeenCalled();
});
