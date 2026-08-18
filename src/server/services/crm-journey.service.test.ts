import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';

const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));

import { contactJourney } from './crm-journey.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const dialect = new PgDialect();

function financeExecutedSql(db: unknown): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  const hit = calls.find((c) => {
    const { sql } = dialect.sqlToQuery(c[0] as SQL);
    return sql.includes('fin_invoice_items');
  });
  if (!hit) throw new Error('no finance query executed');
  return hit[0] as SQL;
}

describe('deterministicMilestones (via contactJourney)', () => {
  it('PARITY: the finance query ILIKE-matches the deposit rule keyword, bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // empty finance/bookings/stat/attr rows — no milestones, query shape is what we assert
    await contactJourney(ctx(db), 'c1');
    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(sql).toContain(
      'bool_or(ii.description is not null and (ii.description not ilike $1)) has_proc',
    );
    expect(sql).toContain('order by (ii2.description ilike $2) asc');
    expect(params).toEqual(['%reserva%', '%reserva%', 'c1']);
  });

  // The mock db's `resolve()` returns the SAME configured value for every raw
  // `tx.execute()` call in a test (only db.select() chains consume
  // resolveSequence — see mock-db.ts), so a single finance-shaped row also
  // answers the bookings/stat/attr queries; those extra reads are harmless
  // (undefined fields) and don't affect the assertions below.
  it('POLARITY: a purchase-only invoice (has_proc true) is labelled from the item, not "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'inv1', at: '2026-01-01T00:00:00Z', amount: 100, has_proc: true, item: 'Botox' }]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv1');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Botox' });
  });

  it('POLARITY: a deposit-only invoice (has_proc false) is labelled "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'inv2', at: '2026-01-02T00:00:00Z', amount: 50, has_proc: false, item: null }]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv2');
    expect(inv).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });
  });
});
