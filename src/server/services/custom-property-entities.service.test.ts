import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  moduleEnabled: vi.fn(),
  capability: vi.fn(),
  maskSensitive: vi.fn(),
  ownerFilter: vi.fn(),
  listUsers: vi.fn(),
}));

function queryResult(): object {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'innerJoin', 'leftJoin', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (rows: Array<Record<string, unknown>>) => unknown) =>
    Promise.resolve(mocks.rows).then(resolve);
  return chain;
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: vi.fn(async (_ctx, callback: (tx: object) => unknown) =>
    callback({ select: () => queryResult(), selectDistinct: () => queryResult() }),
  ),
}));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: mocks.moduleEnabled }));
vi.mock('$server/services/rbac.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$server/services/rbac.service')>();
  return {
    ...actual,
    hasOrgCapability: mocks.capability,
    shouldMaskSensitive: mocks.maskSensitive,
    ownerFilter: mocks.ownerFilter,
  };
});
vi.mock('$server/services/user.service', () => ({ listUsers: mocks.listUsers }));

import { authorizeCustomPropertyRecords } from './custom-property-entities.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ctx = { tenantId: 'org-a', profileId: 'profile-a', db: {} } as CoreCtx;
const locals: App.Locals = {
  user: {
    id: 'user-a',
    supabaseId: 'profile-a',
    email: 'custom-properties@qa.minion.test',
    displayName: 'Custom properties tester',
    role: 'user',
  },
};

describe('custom property entity authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [{ id: ID }];
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.capability.mockResolvedValue(true);
    mocks.maskSensitive.mockResolvedValue(false);
    mocks.ownerFilter.mockResolvedValue(undefined);
    mocks.listUsers.mockResolvedValue([]);
  });

  it.each([
    'stock.items',
    'stock.entries',
    'pos.catalog',
    'crm.customers',
    'finances.invoices',
    'finances.purchases',
    'scheduling.bookings',
  ])('authorizes canonical organization rows for %s', async (tableId) => {
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, tableId, [ID, OTHER], 'view'),
    ).resolves.toEqual({ [ID]: { canEdit: true } });
  });

  it('uses the feature module IDs for finance and socials enablement', async () => {
    mocks.rows = [{ id: ID }];
    await authorizeCustomPropertyRecords(locals, ctx, 'finances.invoices', [ID], 'view');
    expect(mocks.moduleEnabled).toHaveBeenCalledWith(ctx, 'finances');

    mocks.rows = [{ campaignId: 'campaign-1' }];
    await authorizeCustomPropertyRecords(
      locals,
      ctx,
      'socials.campaigns',
      ['c:campaign-1'],
      'view',
    );
    expect(mocks.moduleEnabled).toHaveBeenLastCalledWith(ctx, 'socials');
  });

  it('allows only c: campaign records backed by authorized insight rows', async () => {
    mocks.rows = [{ campaignId: 'campaign-1' }];
    await expect(
      authorizeCustomPropertyRecords(
        locals,
        ctx,
        'socials.campaigns',
        ['c:campaign-1', 's:set-1', 'a:ad-1'],
        'view',
      ),
    ).resolves.toEqual({ 'c:campaign-1': { canEdit: true } });
  });

  it('keeps employee and unenrolled-member permissions independent', async () => {
    mocks.rows = [{ id: ID }];
    mocks.capability.mockImplementation(async (_locals, module: string, action: string) => {
      if (action === 'view') return true;
      return module === 'scheduling' && action === 'edit';
    });
    mocks.listUsers.mockResolvedValue([
      { id: OTHER, accountType: 'person' },
      { id: ID, accountType: 'service' },
    ]);
    const access = await authorizeCustomPropertyRecords(
      locals,
      ctx,
      'team.people',
      [ID, `member:${OTHER}`, `member:${ID}`],
      'view',
    );
    expect(access).toEqual({
      [ID]: { canEdit: true },
      [`member:${OTHER}`]: { canEdit: false },
    });
  });

  it('fails closed for masked sensitive data, disabled modules and malformed IDs', async () => {
    mocks.maskSensitive.mockResolvedValue(true);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'crm.customers', [ID], 'view'),
    ).resolves.toEqual({});

    mocks.maskSensitive.mockResolvedValue(false);
    mocks.moduleEnabled.mockResolvedValue(false);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'stock.items', [ID], 'view'),
    ).resolves.toEqual({});

    mocks.moduleEnabled.mockResolvedValue(true);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'stock.items', ['not-a-uuid'], 'view'),
    ).resolves.toEqual({});
  });

  it('omits records from edit authorization when the owning edit capability is absent', async () => {
    mocks.capability.mockImplementation(
      async (_locals, _module: string, action: string) => action === 'view',
    );
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'stock.items', [ID], 'edit'),
    ).resolves.toEqual({});
  });
});
