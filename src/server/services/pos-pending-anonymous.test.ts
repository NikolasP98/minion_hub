import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tx: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(state.tx),
}));
import { listPendingSchedulingLines } from './pos-accounts.service';

beforeEach(() => {
  for (const method of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit'])
    state.tx[method] = vi.fn(() => state.tx);
  state.tx.offset = vi.fn(async () => []);
});

describe('unassigned pending query', () => {
  it('filters both identity facets in the database before applying page limits', async () => {
    await listPendingSchedulingLines(
      { db: {} as never, tenantId: 'org' },
      { anonymousOnly: true, offset: 50, limit: 51 },
    );
    const query = new PgDialect().sqlToQuery(state.tx.where.mock.calls[0][0]);
    expect(query.sql).toContain('"pos_tickets"."party_id" is null');
    expect(query.sql).toContain('"pos_tickets"."crm_contact_id" is null');
    expect(query.params).toContain('org');
    expect(state.tx.limit).toHaveBeenCalledWith(51);
    expect(state.tx.offset).toHaveBeenCalledWith(50);
  });
  it('preserves the inclusive calendar tray query by default', async () => {
    await listPendingSchedulingLines({ db: {} as never, tenantId: 'org' });
    const query = new PgDialect().sqlToQuery(state.tx.where.mock.calls[0][0]);
    expect(query.sql).not.toContain('"pos_tickets"."party_id" is null');
    expect(state.tx.limit).toHaveBeenCalledWith(200);
    expect(state.tx.offset).toHaveBeenCalledWith(0);
  });
});
