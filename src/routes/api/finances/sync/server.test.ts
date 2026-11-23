import { describe, expect, it, vi } from 'vitest';

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(false),
}));
vi.mock('$server/services/finance-sync-jobs.service', () => ({ enqueueJob: vi.fn() }));
vi.mock('$server/services/finance-sync.service', () => ({ advanceJob: vi.fn() }));

describe('POST /api/finances/sync', () => {
  it('answers 404 module_disabled when finances is switched off', async () => {
    const { POST } = await import('./+server');
    await expect(
      POST({ locals: {}, request: new Request('http://x') } as never),
    ).rejects.toMatchObject({
      status: 404,
      body: { code: 'module_disabled' },
    });
  });
});
