import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSession, validateSession, deleteSession } from './session';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-session-id-000000001',
  nowMs: () => 1_700_000_000_000,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSession', () => {
  it('returns a 64-char hex token', async () => {
    const { db } = createMockDb();
    const result = await createSession(db, 'user-1');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns expiresAt ~30 days from now', async () => {
    const { db } = createMockDb();
    const result = await createSession(db, 'user-1');
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBe(1_700_000_000_000 + thirtyDays);
  });

  it('calls db.insert', async () => {
    const { db } = createMockDb();
    await createSession(db, 'user-1');
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('validateSession', () => {
  it('returns null when no matching session', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await validateSession(db, 'bad-token');
    expect(result).toBe(null);
  });

  it('returns user and tenant for valid session', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      // 1st select: session + user join
      [
        {
          sessionId: 's1',
          userId: 'u1',
          expiresAt: Date.now() + 86_400_000,
          email: 'a@b.com',
          displayName: 'Alice',
        },
      ],
      // 2nd select: tenant membership
      [{ tenantId: 't1', role: 'admin' }],
    ]);

    const result = await validateSession(db, 'valid-token');
    expect(result).not.toBe(null);
    expect(result!.user.email).toBe('a@b.com');
    expect(result!.tenantId).toBe('t1');
    expect(result!.role).toBe('admin');
  });
});

describe('deleteSession', () => {
  it('calls db.delete', async () => {
    const { db } = createMockDb();
    await deleteSession(db, 'some-token');
    expect(db.delete).toHaveBeenCalled();
  });
});
