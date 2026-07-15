import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolClient, resetAllPgPools } = vi.hoisted(() => ({
  poolClient: {},
  resetAllPgPools: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./pg-pool', () => ({
  getPgClient: vi.fn(() => poolClient),
  getCriticalPgClient: vi.fn(() => poolClient),
  getRlsPgClient: vi.fn(() => poolClient),
  resetAllPgPools,
}));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock('@minion-stack/db/pg', () => ({}));

import { withCoreDbRecovery } from './pg-client';

describe('withCoreDbRecovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a queued operation finish during the grace window', async () => {
    const result = await withCoreDbRecovery(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('healthy'), 7)),
      5,
    );

    expect(result).toBe('healthy');
  });

  it('continues waiting on the same queued operation instead of duplicating it', async () => {
    const operation = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('healthy'), 12)),
    );

    await expect(withCoreDbRecovery(operation, 5)).resolves.toBe('healthy');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('bounds an operation that never settles, resetting wedged pools once', async () => {
    const result = await withCoreDbRecovery(async () => {
      return new Promise<string>(() => undefined);
    }, 5).catch((error: unknown) => error);

    expect(result).toMatchObject({ name: 'CoreDbOperationTimeout', timeoutMs: 10 });
    expect(resetAllPgPools).toHaveBeenCalledOnce();
  });

  it('retries when postgres-js removes a destroyed connection', async () => {
    let attempts = 0;
    const result = await withCoreDbRecovery(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('query failed', {
          cause: Object.assign(new Error('pool reset'), { code: 'CONNECTION_DESTROYED' }),
        });
      }
      return 'healthy';
    }, 5);

    expect(result).toBe('healthy');
    expect(attempts).toBe(2);
  });
});
