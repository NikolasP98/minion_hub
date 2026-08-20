import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { normalizeSql } from '$server/test-utils/normalize-sql';
import { normalizeDepositRule, type DepositRule } from './crm-deposit-rule';

const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));

// crm-journey.service.ts resolves the deposit rule through the CRM settings
// boundary (crm-contacts.service.ts's resolveDepositRule), not by reading
// crm_settings itself — mocked here so each test controls the resolved rule
// directly and can assert it was read exactly once per public call, the same
// way `bothEnabled` is stubbed above. `setContactCustomField` stays real
// (importOriginal) since analyzeJourney's atomic-write path is exercised by
// crm-journey.atomic-write.test.ts, not this file.
const resolveDepositRuleMock = vi.fn<(ctx: unknown) => Promise<DepositRule>>();
vi.mock('./crm-contacts.service', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveDepositRule: (ctx: unknown) => resolveDepositRuleMock(ctx),
  };
});

import { contactJourney, analyzeJourney } from './crm-journey.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const dialect = new PgDialect();
const DEFAULT_RULE = normalizeDepositRule(undefined).rule;

function financeExecutedSql(db: unknown): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  const hit = calls.find((c) => {
    const { sql } = dialect.sqlToQuery(c[0] as SQL);
    return sql.includes('fin_invoice_items');
  });
  if (!hit) throw new Error('no finance query executed');
  return hit[0] as SQL;
}

beforeEach(() => {
  resolveDepositRuleMock.mockReset();
  resolveDepositRuleMock.mockResolvedValue(DEFAULT_RULE);
});

describe('deterministicMilestones (via contactJourney)', () => {
  it('PARITY: the full compiled finance query matches the shipped shape, with the resolved rule bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // empty finance/bookings/stat/attr rows — no milestones, query shape is what we assert
    await contactJourney(ctx(db), 'c1');
    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `select fi.id::text id, fi.issued_at at, coalesce(fi.total,0)::float8 amount,
               bool_or(ii.description is not null and coalesce((ii.description not ilike $1), true)) has_proc,
               (select ii2.description from fin_invoice_items ii2
                  where ii2.invoice_id = fi.id and ii2.description is not null
                  order by coalesce((ii2.description ilike $2), false) asc, ii2.total desc nulls last limit 1) item
        from crm_contacts c
        join fin_clients fc on fc.party_id = c.party_id and c.party_id is not null
          and fc.org_id = current_setting('app.current_org_id', true)
        join fin_invoices fi on fi.client_id = fc.id and fi.status is distinct from 'void'
        left join fin_invoice_items ii on ii.invoice_id = fi.id
        where c.id = $3 and c.org_id = current_setting('app.current_org_id', true)
        group by fi.id, fi.issued_at, fi.total
        order by fi.issued_at desc nulls last
        limit 40`,
      ),
    );
    expect(params).toEqual(['%reserva%', '%reserva%', 'c1']);
  });

  it('DEFAULT: absent config resolves to keywords ["reserva"] and label "Reserved a consult"', async () => {
    expect(DEFAULT_RULE).toEqual({ keywords: ['reserva'], label: 'Reserved a consult' });
  });

  // MAPPING, not classification: has_proc is injected directly by the mock, so
  // these prove the JS-side label/type mapping (purchase vs reserve) only.
  // Whether a real invoice-item description lands as has_proc=true/false is
  // proven against real PostgreSQL (same predicate as crm-finance.service.ts
  // and crm-similarity.service.ts) in crm-deposit-rule.sql.integration.test.ts
  // and crm-journey.sql.integration.test.ts.
  //
  // The mock db's `resolve()` returns the SAME configured value for every raw
  // `tx.execute()` call in a test (only db.select() chains consume
  // resolveSequence — see mock-db.ts), so a single finance-shaped row also
  // answers the bookings/stat/attr queries; those extra reads are harmless
  // (undefined fields) and don't affect the assertions below.
  it('MAPPING: has_proc true is labelled from the item, not the reserve label', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'inv1', at: '2026-01-01T00:00:00Z', amount: 100, has_proc: true, item: 'Botox' },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv1');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Botox' });
  });

  it('MAPPING: has_proc false is labelled "Reserved a consult" for the default (absent) config', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'inv2', at: '2026-01-02T00:00:00Z', amount: 50, has_proc: false, item: null }]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv2');
    expect(inv).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });
  });

  it('CUSTOM RULE: configured keywords are bound and "%reserva%" is absent from the compiled query', async () => {
    resolveDepositRuleMock.mockResolvedValue({
      keywords: ['adelanto', 'seña'],
      label: 'Deposit paid',
    });
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(sql).not.toContain('reserva');
    expect(params).not.toContain('%reserva%');
    expect(params).toEqual(['%adelanto%', '%seña%', '%adelanto%', '%seña%', 'c1']);
  });

  it('CUSTOM RULE: deposit-only invoice is labelled with the configured reserve label', async () => {
    resolveDepositRuleMock.mockResolvedValue({
      keywords: ['adelanto', 'seña'],
      label: 'Deposit paid',
    });
    const { db, resolve } = createMockDb();
    resolve([{ id: 'inv3', at: '2026-01-03T00:00:00Z', amount: 80, has_proc: false, item: null }]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv3');
    expect(inv).toMatchObject({ type: 'reserve', label: 'Deposit paid' });
  });

  it('CUSTOM RULE: mixed invoice remains a purchase labelled from the item, not the configured reserve label', async () => {
    resolveDepositRuleMock.mockResolvedValue({
      keywords: ['adelanto', 'seña'],
      label: 'Deposit paid',
    });
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'inv4', at: '2026-01-04T00:00:00Z', amount: 150, has_proc: true, item: 'Relleno' },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv4');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Relleno' });
  });

  it('EMPTY KEYWORDS: the compiled predicates are total-boolean literals, never bound patterns', async () => {
    resolveDepositRuleMock.mockResolvedValue({ keywords: [], label: 'Unused' });
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(normalizeSql(sql)).toContain(
      normalizeSql('bool_or(ii.description is not null and coalesce(true, true))'),
    );
    expect(normalizeSql(sql)).toContain(normalizeSql('order by coalesce(false, false) asc'));
    expect(params).toEqual(['c1']);
  });

  it('EMPTY KEYWORDS: a non-null item always classifies as purchase, never reserve', async () => {
    resolveDepositRuleMock.mockResolvedValue({ keywords: [], label: 'Unused' });
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'inv5', at: '2026-01-05T00:00:00Z', amount: 30, has_proc: true, item: 'Consulta' },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv5');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Consulta' });
  });

  it('resolves the deposit rule exactly once per contactJourney call', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    expect(resolveDepositRuleMock).toHaveBeenCalledTimes(1);
  });

  it('resolves the deposit rule exactly once per analyzeJourney call (no OPENROUTER_API_KEY ⇒ deterministic-only return)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await analyzeJourney(ctx(db), 'c1');
    expect(resolveDepositRuleMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveDepositRule (crm-contacts.service) is not called when finance is disabled', () => {
  it('skips the settings read entirely when the finance module is off', async () => {
    bothEnabled.mockResolvedValueOnce(false as never);
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    expect(resolveDepositRuleMock).not.toHaveBeenCalled();
  });
});
