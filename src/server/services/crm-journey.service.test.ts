import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { normalizeSql } from '$server/test-utils/normalize-sql';

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
  it('PARITY: the full compiled finance query matches the shipped shape, with the deposit rule bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // empty finance/bookings/stat/attr rows — no milestones, query shape is what we assert
    await contactJourney(ctx(db), 'c1');
    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `select fi.id::text id, fi.issued_at at, coalesce(fi.total,0)::float8 amount,
               bool_or(coalesce((ii.description ilike $1), false)) only_reserva_flag,
               bool_or(ii.description is not null and coalesce((ii.description not ilike $2), true)) has_proc,
               (select ii2.description from fin_invoice_items ii2
                  where ii2.invoice_id = fi.id and ii2.description is not null
                  order by coalesce((ii2.description ilike $3), false) asc, ii2.total desc nulls last limit 1) item
        from crm_contacts c
        join fin_clients fc on fc.party_id = c.party_id and c.party_id is not null
          and fc.org_id = current_setting('app.current_org_id', true)
        join fin_invoices fi on fi.client_id = fc.id and fi.status is distinct from 'void'
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        where c.id = $4 and c.org_id = current_setting('app.current_org_id', true)
        group by fi.id, fi.issued_at, fi.total
        order by fi.issued_at desc nulls last
        limit 40`,
      ),
    );
    expect(params).toEqual(['%reserva%', '%reserva%', '%reserva%', 'c1']);
  });

  // MAPPING, not classification: has_proc is injected directly by the mock, so
  // these prove the JS-side label/type mapping (purchase vs reserve) only.
  // Whether a real invoice-item description lands as has_proc=true/false is
  // proven against real PostgreSQL (same predicate as crm-finance.service.ts
  // and crm-similarity.service.ts) in crm-deposit-rule.sql.integration.test.ts.
  //
  // The mock db's `resolve()` returns the SAME configured value for every raw
  // `tx.execute()` call in a test (only db.select() chains consume
  // resolveSequence — see mock-db.ts), so a single finance-shaped row also
  // answers the bookings/stat/attr queries; those extra reads are harmless
  // (undefined fields) and don't affect the assertions below.
  it('MAPPING: has_proc true is labelled from the item, not "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'inv1', at: '2026-01-01T00:00:00Z', amount: 100, has_proc: true, item: 'Botox' },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv1');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Botox' });
  });

  it('MAPPING: has_proc false is labelled "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'inv2', at: '2026-01-02T00:00:00Z', amount: 50, has_proc: false, item: null }]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv2');
    expect(inv).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });
  });
});
