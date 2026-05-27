import { describe, it, expect, vi } from 'vitest';
import { resolveUserTenant } from './tenant.js';
import type { Db } from '$server/db/client';

/**
 * Fake Drizzle query builder for the `member` lookup:
 *   db.select(...).from(...).where(...).limit(1) -> Promise<rows>
 */
function fakeDb(memberRows: Array<{ orgId: string }>): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(memberRows),
  };
  return { select: vi.fn(() => chain) } as unknown as Db;
}

describe('resolveUserTenant', () => {
  it('uses activeOrganizationId when present, without querying membership', async () => {
    const select = vi.fn();
    const db = { select } as unknown as Db;
    const result = await resolveUserTenant(db, {
      userId: 'u1',
      activeOrganizationId: 'org-active',
      fallbackToMembership: false,
    });
    expect(result).toEqual({ orgId: 'org-active', ctx: { db, tenantId: 'org-active' } });
    expect(select).not.toHaveBeenCalled();
  });

  it('falls back to first membership when allowed and no active org', async () => {
    const db = fakeDb([{ orgId: 'org-member' }]);
    const result = await resolveUserTenant(db, {
      userId: 'u1',
      fallbackToMembership: true,
    });
    expect(result).toEqual({ orgId: 'org-member', ctx: { db, tenantId: 'org-member' } });
  });

  it('returns null when fallback is disabled and no active org (Better Auth branch)', async () => {
    const select = vi.fn();
    const db = { select } as unknown as Db;
    const result = await resolveUserTenant(db, {
      userId: 'u1',
      activeOrganizationId: null,
      fallbackToMembership: false,
    });
    expect(result).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('returns null when fallback is allowed but the user has no membership', async () => {
    const db = fakeDb([]);
    const result = await resolveUserTenant(db, {
      userId: 'orphan',
      fallbackToMembership: true,
    });
    expect(result).toBeNull();
  });

  it('prefers activeOrganizationId over membership even when fallback is allowed', async () => {
    const db = fakeDb([{ orgId: 'org-member' }]);
    const result = await resolveUserTenant(db, {
      userId: 'u1',
      activeOrganizationId: 'org-active',
      fallbackToMembership: true,
    });
    expect(result?.orgId).toBe('org-active');
  });
});
