import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Same mocking shape as crm-contacts.service.test.ts: withOrgCore's real impl
// is `db.transaction(cb => cb(db))`, so the mock forwards into it and the
// existing db.update/.returning() chain + resolve()/resolveSequence() keep
// working transparently.
const mockWithOrgCore = vi.fn(
  (scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } }, fn: (tx: unknown) => unknown) =>
    scope.db.transaction((tx: unknown) => fn(tx)),
);
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) => mockWithOrgCore(scope as never, fn),
}));

const mockBustCrmList = vi.fn<(tenantId: string) => Promise<unknown>>();
vi.mock('./crm-contacts.service', () => ({
  bustCrmList: (t: string) => mockBustCrmList(t),
}));

import { setUserRelationship, setAiRelationship, resumeAiSuggestions } from './crm-relationship.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setUserRelationship', () => {
  it('writes source:user unconditionally (no owner guard) and busts the cache', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]); // .returning() → one row → applied
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setUserRelationship(ctx, 'c1', { label: 'amiga del trabajo', category: 'friend' });

    expect(result.applied).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockBustCrmList).toHaveBeenCalledWith('org-1');
  });

  it('accepts label:null as an explicit user clear', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setUserRelationship(ctx, 'c1', { label: null, category: 'unknown' });

    expect(result.applied).toBe(true);
  });

  it('accepts an ownerId (record-level scope, spec F2) without changing the success path', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setUserRelationship(ctx, 'c1', { label: 'amiga', category: 'friend' }, 'profile-1');

    expect(result.applied).toBe(true);
    expect(mockBustCrmList).toHaveBeenCalledWith('org-1');
  });

  it('is not applied (no cache bust) when the owner guard excludes the row — 0 rows matched', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // not owned by this profile → WHERE guard excludes it
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setUserRelationship(ctx, 'c1', { label: 'amiga', category: 'friend' }, 'profile-1');

    expect(result.applied).toBe(false);
    expect(mockBustCrmList).not.toHaveBeenCalled();
  });
});

describe('setAiRelationship', () => {
  it('applies when the contact is not user-pinned and the claim token matches', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setAiRelationship(ctx, 'c1', { label: 'mamá', category: 'family', confidence: 0.9 }, 'token-1');

    expect(result.applied).toBe(true);
    expect(mockBustCrmList).toHaveBeenCalledWith('org-1');
  });

  it('is refused (no-op, no cache bust) when the row is user-pinned — the WHERE guard excludes it', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // guard clause filtered the row out → 0 rows returned
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setAiRelationship(ctx, 'c1', { label: 'mamá', category: 'family' }, 'token-1');

    expect(result.applied).toBe(false);
    expect(mockBustCrmList).not.toHaveBeenCalled();
  });

  it('is refused when the claim token does not match the row (expired/superseded lease)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // token mismatch → WHERE guard excludes the row
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setAiRelationship(ctx, 'c1', { label: 'mamá', category: 'family' }, 'stale-token');

    expect(result.applied).toBe(false);
    expect(mockBustCrmList).not.toHaveBeenCalled();
  });
});

describe('resumeAiSuggestions', () => {
  it('clears the pin and busts the cache when a row matched', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]); // .returning() → one row → applied
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await resumeAiSuggestions(ctx, 'c1');

    expect(result.applied).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockBustCrmList).toHaveBeenCalledWith('org-1');
  });

  it('is not applied (no cache bust) when 0 rows matched — not found or not owned', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await resumeAiSuggestions(ctx, 'c1', 'profile-1');

    expect(result.applied).toBe(false);
    expect(mockBustCrmList).not.toHaveBeenCalled();
  });
});
