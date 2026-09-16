import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * `/pos/accounts` "Active packages" fix: the header count used to be
 * `pos_package_grants.status = 'active'` alone, which is the STORED column —
 * only ever 'active' or 'cancelled' (pos-accounts.service.ts jsdoc). A grant
 * whose sessions are all redeemed, or whose expiry date has passed, stays
 * stored 'active' forever, so the header over-counted against what the sell
 * page's per-client drawer (listGrants → grantStatus, pos-accounts.logic.ts)
 * would actually let staff draw a session from.
 *
 * The pure boundary math (exhausted at used>=total, expired at
 * expiresAt<today, cancelled outranks both) is already exhaustively covered
 * by pos-accounts.logic.test.ts's grantStatus suite. This asserts the
 * aggregate SQL encodes the same three conditions, so a client with one
 * active + one exhausted + one expired + one cancelled grant reports 1, not 4.
 */
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));
vi.mock('./pos.service', () => ({
  PosError: class PosError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  getPosSettings: async () => ({}),
}));
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));

const execute = vi.fn().mockResolvedValue([]);
const tx = { execute };

const ctx = { db: {} as never, tenantId: 'org-1' };

describe('listClientAccounts — activeGrants', () => {
  it('counts only grants whose derived status is active (excludes exhausted/expired, cancelled never matches status=active)', async () => {
    const { listClientAccounts } = await import('./pos-accounts.service');
    await listClientAccounts(ctx);

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    // status='active' is the only branch a stored 'cancelled' grant never hits.
    expect(query.sql).toContain(`pg.status = 'active'`);
    // not-exhausted: sessions_total must still exceed non-reversed redemptions.
    expect(query.sql).toContain('pg.sessions_total >');
    expect(query.sql).toContain('pr.reversed_at is null');
    // not-expired: null expiry, or expiry on/after "today" (same org-timezone
    // resolution as pos-packages.service.ts's orgToday, via getFinSettings).
    expect(query.sql).toContain('pg.expires_at is null or pg.expires_at >=');
  });
});
