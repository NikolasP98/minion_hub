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
