import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  listClientAccounts: vi.fn(),
  resolveClientAccount: vi.fn(),
  listPendingSchedulingLines: vi.fn(),
  listSellables: vi.fn(),
  listResources: vi.fn(),
  listEventTypes: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/pos-accounts.service', () => ({
  listClientAccounts: mocks.listClientAccounts,
  resolveClientAccount: mocks.resolveClientAccount,
  listPendingSchedulingLines: mocks.listPendingSchedulingLines,
}));
vi.mock('$server/services/pos.service', () => ({ listSellables: mocks.listSellables }));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: mocks.listResources,
  listEventTypes: mocks.listEventTypes,
}));
import { load } from './+page.server';

const ctx = { tenantId: 'org', db: {} };
const run = (params = '') =>
  load({
    locals: { moduleStates: { scheduling: true } },
    url: new URL(`http://localhost/pos/accounts${params}`),
    depends: vi.fn(),
  } as unknown as Parameters<typeof load>[0]);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCoreCtx.mockResolvedValue(ctx);
  for (const key of [
    'listClientAccounts',
    'listSellables',
    'listResources',
    'listEventTypes',
    'listPendingSchedulingLines',
  ] as const)
    mocks[key].mockResolvedValue([]);
});
describe('unassigned services in Accounts', () => {
  it('requests anonymous lines before applying the page boundary', async () => {
    await run('?pendingPage=2');
    expect(mocks.listPendingSchedulingLines).toHaveBeenCalledWith(ctx, {
      anonymousOnly: true,
      offset: 50,
      limit: 51,
    });
  });
  it('uses an extra row to offer the next page without hiding older services', async () => {
    mocks.listPendingSchedulingLines.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ lineId: `line-${i}`, ticketId: `ticket-${i}` })),
    );
    const result = await run();
    expect(result?.unassignedPending).toHaveLength(50);
    expect(result?.hasMoreUnassigned).toBe(true);
  });
  it('normalizes invalid page parameters', async () => {
    const result = await run('?pendingPage=-5');
    expect(result?.pendingPage).toBe(1);
  });
});
