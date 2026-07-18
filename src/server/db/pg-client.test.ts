import { describe, test, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_DB_URL: 'postgresql://test:test@localhost:5432/test' },
}));

vi.mock('@minion-stack/db/pg', () => ({
  gateway: {},
  userGateway: {},
  profiles: {},
}));

describe('getCoreDb', () => {
  test('returns a drizzle instance (not null)', async () => {
    // We can't connect in tests, but we verify the factory runs and returns an object.
    const { getCoreDb } = await import('./pg-client');
    const db = getCoreDb();
    expect(db).toBeTruthy();
    expect(typeof db.select).toBe('function');
  });
});

describe('retryOnPoolDrop', () => {
  const drop = () => Object.assign(new Error('write CONNECTION_CLOSED pooler:6543'), { code: 'CONNECTION_CLOSED' });

  test('retries once and succeeds after a transient pooler drop', async () => {
    const { retryOnPoolDrop } = await import('./pg-client');
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw drop();
      return 'ok';
    });
    await expect(retryOnPoolDrop(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  test('does not retry non-recoverable errors', async () => {
    const { retryOnPoolDrop } = await import('./pg-client');
    const op = vi.fn(async () => { throw new Error('unique constraint violation'); });
    await expect(retryOnPoolDrop(op)).rejects.toThrow('unique constraint');
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('runs the op once when it succeeds outright', async () => {
    const { retryOnPoolDrop } = await import('./pg-client');
    const op = vi.fn(async () => 42);
    await expect(retryOnPoolDrop(op)).resolves.toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
