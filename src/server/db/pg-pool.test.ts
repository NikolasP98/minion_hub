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
vi.mock('$app/environment', () => ({ dev: true }));

vi.mock('postgres', () => ({ default: mocks.postgres }));

describe('getPgClient', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.postgres.mockClear();
    mocks.client.end.mockClear();
    delete (globalThis as typeof globalThis & { __minionHubPgPool?: unknown }).__minionHubPgPool;
    delete (globalThis as typeof globalThis & { __minionHubPgCriticalPool?: unknown })
      .__minionHubPgCriticalPool;
    delete (globalThis as typeof globalThis & { __minionHubPgRlsPool?: unknown })
      .__minionHubPgRlsPool;
    delete (globalThis as typeof globalThis & { __minionHubPgPoolReset?: unknown })
      .__minionHubPgPoolReset;
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

  test('isolates critical dev reads in a bounded pool (pool size capped at 4)', async () => {
    const { getCriticalPgClient, getPgClient } = await import('./pg-pool');
    getPgClient();
    getCriticalPgClient();

    // min(4, poolSize=3) — a single-connection critical pool serialized all
    // app-shell gates behind one remote conn and produced 20s timeouts.
    expect(mocks.postgres).toHaveBeenNthCalledWith(
      2,
      'postgresql://test:test@localhost:6543/test',
      expect.objectContaining({ max: 3, prepare: false }),
    );
  });

  test('isolates role-scoped transactions from ordinary pipelined queries', async () => {
    const { getRlsPgClient, getPgClient } = await import('./pg-pool');
    getPgClient();
    getRlsPgClient();

    expect(mocks.postgres).toHaveBeenNthCalledWith(
      2,
      'postgresql://test:test@localhost:6543/test',
      expect.objectContaining({ max: 1, prepare: false }),
    );
  });

  test('destroys a stalled pool so the next call creates a replacement', async () => {
    const { getPgClient, resetPgClient } = await import('./pg-pool');
    const first = getPgClient();

    await resetPgClient();
    const second = getPgClient();

    expect(first).toBe(mocks.client);
    expect(mocks.client.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
    expect(second).toBe(mocks.client);
  });

  test('does not let a stale timeout destroy a replacement pool', async () => {
    const replacement = { end: vi.fn().mockResolvedValue(undefined) };
    mocks.postgres.mockReturnValueOnce(mocks.client).mockReturnValueOnce(replacement);
    const { getPgClient, resetPgClient } = await import('./pg-pool');
    const stale = getPgClient();

    await resetPgClient(stale);
    expect(getPgClient()).toBe(replacement);
    await resetPgClient(stale);

    expect(replacement.end).not.toHaveBeenCalled();
  });
});
