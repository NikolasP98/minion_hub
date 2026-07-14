import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, listModuleStates, withOrgCore } = vi.hoisted(() => {
  const execute = vi.fn();
  return {
    execute,
    listModuleStates: vi.fn(),
    withOrgCore: vi.fn(async (_ctx: unknown, operation: (tx: { execute: typeof execute }) => unknown) =>
      operation({ execute }),
    ),
  };
});

vi.mock('./modules.service', () => ({ listModuleStates }));
vi.mock('$server/db/with-org-core', () => ({ withOrgCore }));

import { searchRecords } from './search.service';

describe('searchRecords authorization and destinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listModuleStates.mockResolvedValue({ crm: true, support: true, sales: true });
  });

  it('only queries allowed record families', async () => {
    execute.mockResolvedValueOnce([]);

    await searchRecords(
      {} as never,
      'Acme',
      {
        crm: { allowed: false },
        support: { allowed: false },
        sales: { allowed: true, ownerId: 'user-1' },
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('links sales results to the existing order detail route', async () => {
    execute.mockResolvedValueOnce([
      {
        id: 'order-42',
        description: 'Annual renewal',
        human_id: 'SO-0042',
        customer_name: 'Acme',
      },
    ]);

    const hits = await searchRecords(
      {} as never,
      'Acme',
      {
        crm: { allowed: false },
        support: { allowed: false },
        sales: { allowed: true },
      },
    );

    expect(hits).toEqual([
      expect.objectContaining({ type: 'order', id: 'order-42', href: '/sales/order-42' }),
    ]);
  });
});
