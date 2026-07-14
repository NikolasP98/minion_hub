import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = { end: vi.fn().mockResolvedValue(undefined) };
  return {
    client,
    postgres: vi.fn(() => client),
  };
});

vi.mock('$env/dynamic/private', () => ({
  env: {
    SUPABASE_DB_URL: ' postgresql://test:test@localhost:6543/test\n',
    SUPABASE_DB_POOL_SIZE: '3',
  },
}));

vi.mock('postgres', () => ({ default: mocks.postgres }));

describe('getPgClient', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.postgres.mockClear();
    mocks.client.end.mockClear();
    delete (globalThis as typeof globalThis & { __minionHubPgPool?: unknown }).__minionHubPgPool;
  });

  test('reuses one physical pool across server-module reloads', async () => {
    const firstModule = await import('./pg-pool');
    const first = firstModule.getPgClient();

    vi.resetModules();
    const secondModule = await import('./pg-pool');
    const second = secondModule.getPgClient();

    expect(second).toBe(first);
    expect(mocks.postgres).toHaveBeenCalledTimes(1);
  });

  test('creates a bounded, recyclable serverless pool', async () => {
    const { getPgClient } = await import('./pg-pool');
    getPgClient();

    expect(mocks.postgres).toHaveBeenCalledWith(
      'postgresql://test:test@localhost:6543/test',
      expect.objectContaining({
        prepare: false,
        max: 3,
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 600,
      }),
    );
  });
});
