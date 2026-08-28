import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { normalizeSql } from '$server/test-utils/normalize-sql';

const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));

// The org's deposit rule is resolved from crm_settings by the settings layer
// (proven there, against real blobs, in crm-settings.service.test.ts). Mocked
// here so each test can state WHICH org's vocabulary the service is threading.
const resolveDepositRule = vi.fn<() => Promise<DepositRule>>(async () => DEFAULT_DEPOSIT_RULE);
vi.mock('./crm-settings.service', () => ({ resolveDepositRule: () => resolveDepositRule() }));

import { DEFAULT_DEPOSIT_RULE, type DepositRule } from './crm-deposit-rule';

import { analyzeJourney, contactJourney } from './crm-journey.service';

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
               bool_or(coalesce((ii.description ilike $1), false)) only_deposit_flag,
               bool_or(ii.description is not null and coalesce((ii.description not ilike $2), true)) has_proc,
               (select ii2.description from fin_invoice_items ii2
                  where ii2.invoice_id = fi.id and ii2.description is not null
                  order by (case when coalesce((ii2.description ilike $3), false) then 1 else 0 end) asc, ii2.total desc nulls last limit 1) item
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
    // The projection was renamed off the hardcoded Spanish keyword when the
    // rule became per-org; a rule named after one org's vocabulary is exactly
    // what this slice removed.
    expect(sql).not.toContain('only_reserva_flag');
  });

  // MAPPING, not classification: has_proc is injected directly by the mock, so
  // these prove the JS-side label/type mapping (purchase vs reserve) only.
  // Whether a real invoice-item description lands as has_proc=true/false is
  // proven against real PostgreSQL (same predicate as crm-finance.service.ts
  // and crm-similarity.service.ts) in crm-deposit-rule.sql.integration.test.ts
  // and, for this service's own query, crm-journey.sql.integration.test.ts.
  //
  // The mock db's `resolve()` returns the SAME configured value for every raw
  // `tx.execute()` call in a test (only db.select() chains consume
  // resolveSequence — see mock-db.ts), so a single finance-shaped row also
  // answers the bookings/stat/attr queries; those extra reads are harmless
  // (undefined fields) and don't affect the assertions below.
  it('MAPPING: has_proc true is labelled from the item, not "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv1',
        at: '2026-01-01T00:00:00Z',
        amount: 100,
        only_deposit_flag: false,
        has_proc: true,
        item: 'Botox',
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv1');
    expect(inv).toMatchObject({ type: 'purchase', label: 'Botox' });
  });

  it('MAPPING: a deposit line with no procedure line is labelled "Reserved a consult"', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv2',
        at: '2026-01-02T00:00:00Z',
        amount: 50,
        only_deposit_flag: true,
        has_proc: false,
        item: null,
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    const inv = journey.find((m) => m.id === 'inv:inv2');
    expect(inv).toMatchObject({ type: 'reserve', label: 'Reserved a consult' });
  });

  // The legacy `!has_proc ⇒ reserve` mapping is preserved unconditionally for
  // the DEFAULT rule (and any non-empty rule): an invoice whose lines match
  // neither predicate (every description null, or no line items at all) is
  // still captioned as a reserve, exactly as it was before per-org keywords
  // existed — S2 requires every existing org to stay byte-identical. Only an
  // EXPLICIT `keywords: []` rule withholds the caption (see the S2 describe
  // block below).
  it('MAPPING: an invoice matching neither predicate still emits the legacy reserve milestone under the default rule', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv5',
        at: '2026-01-03T00:00:00Z',
        amount: 75,
        only_deposit_flag: false,
        has_proc: false,
        item: null,
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    expect(journey.find((m) => m.id === 'inv:inv5')).toMatchObject({
      type: 'reserve',
      label: 'Reserved a consult',
    });
  });
});

describe('per-org deposit rule (S2 — crm_settings.value.deposit drives match AND caption)', () => {
  it('MATCH: the org’s keywords are bound into all three predicates of the finance query', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: ['adelanto'], label: 'Adelanto' });
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    expect(dialect.sqlToQuery(financeExecutedSql(db)).params).toEqual([
      '%adelanto%',
      '%adelanto%',
      '%adelanto%',
      'c1',
    ]);
  });

  it('MATCH: a MULTI-keyword rule binds every keyword to every predicate, in order, and never the default', async () => {
    resolveDepositRule.mockResolvedValueOnce({
      keywords: ['adelanto', 'seña'],
      label: 'Deposit paid',
    });
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    const { params } = dialect.sqlToQuery(financeExecutedSql(db));
    // Three predicates × two keywords, each wrapped by escapeLikePattern — the
    // non-ASCII keyword goes through as a bound parameter, never interpolated.
    expect(params).toEqual([
      '%adelanto%',
      '%seña%',
      '%adelanto%',
      '%seña%',
      '%adelanto%',
      '%seña%',
      'c1',
    ]);
    expect(params).not.toContain('%reserva%');
  });

  it('CAPTION: a deposits-only invoice renders the org’s label, not the FACES default', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: ['deposit'], label: 'Deposit' });
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv3',
        at: '2026-03-01T00:00:00Z',
        amount: 50,
        only_deposit_flag: true,
        has_proc: false,
        item: null,
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    expect(journey.find((m) => m.id === 'inv:inv3')).toMatchObject({
      type: 'reserve',
      label: 'Deposit',
    });
  });

  it('CAPTION: the label never leaks onto a real purchase — that milestone still names the item', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: ['deposit'], label: 'Deposit' });
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv4',
        at: '2026-03-02T00:00:00Z',
        amount: 900,
        only_deposit_flag: false,
        has_proc: true,
        item: 'Botox',
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    expect(journey.find((m) => m.id === 'inv:inv4')).toMatchObject({
      type: 'purchase',
      label: 'Botox',
    });
  });

  // Behavior first, SQL second: the row fed in is the one the empty rule
  // actually produces — `only_deposit_flag` false (nothing can match `false`)
  // and `has_proc` false (an invoice whose lines carry no description). Under
  // the old `!has_proc ⇒ reserve` mapping this returned a milestone captioned
  // 'x' for an org that has no deposit concept; the assertion is that NO
  // invoice milestone is emitted, not merely that the SQL compiled to `false`.
  it('an org with NO deposit concept (keywords: []) never emits a deposit milestone', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: [], label: 'x' });
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv6',
        at: '2026-04-01T00:00:00Z',
        amount: 120,
        only_deposit_flag: false,
        has_proc: false,
        item: null,
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    expect(journey.filter((m) => m.id.startsWith('inv:'))).toEqual([]);
    expect(journey.some((m) => m.type === 'reserve' || m.label === 'x')).toBe(false);

    const { sql, params } = dialect.sqlToQuery(financeExecutedSql(db));
    expect(sql).toContain('bool_or(false) only_deposit_flag');
    expect(sql).toContain('bool_or(ii.description is not null and true) has_proc');
    // REGRESSION GUARD: the representative-item sort key must stay a CASE.
    // A zero-keyword rule compiles depositMatchSql to the literal `false`, and
    // `order by false` is a PostgreSQL 42601 ("non-integer constant in ORDER
    // BY") — the exact error an org with no deposit concept would hit on every
    // contact-journey load.
    expect(sql).toContain('order by (case when false then 1 else 0 end) asc');
    expect(sql).not.toMatch(/order by false\b/);
    expect(params).toEqual(['c1']);
  });

  // The counterpart to the case above: withholding the deposit caption must
  // not cost that org its PURCHASE milestones. With no keywords,
  // notDepositMatchSql is the total `true`, so any invoice with a described
  // line is has_proc — a purchase, labelled from the item.
  it('an org with NO deposit concept still gets its purchase milestones', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: [], label: 'None' });
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'inv7',
        at: '2026-04-02T00:00:00Z',
        amount: 100,
        only_deposit_flag: false,
        has_proc: true,
        item: 'Any item',
      },
    ]);
    const journey = await contactJourney(ctx(db), 'c1');
    expect(journey.find((m) => m.id === 'inv:inv7')).toMatchObject({
      type: 'purchase',
      label: 'Any item',
    });
  });
});

describe('settings read is demand-driven', () => {
  it('an org with finances OFF resolves no deposit rule at all — no settings query', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    resolveDepositRule.mockClear();
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    expect(resolveDepositRule).not.toHaveBeenCalled();
  });

  it('an org with finances ON resolves it exactly once per journey', async () => {
    resolveDepositRule.mockClear();
    const { db, resolve } = createMockDb();
    resolve([]);
    await contactJourney(ctx(db), 'c1');
    expect(resolveDepositRule).toHaveBeenCalledTimes(1);
  });

  // analyzeJourney is the OTHER public entry into deterministicMilestones, so
  // it gets the same once-per-call guarantee. No OPENROUTER_API_KEY in the test
  // env ⇒ it returns the deterministic base without calling the model.
  it('analyzeJourney resolves it exactly once too — the AI layer adds no extra settings read', async () => {
    resolveDepositRule.mockClear();
    const { db, resolve } = createMockDb();
    resolve([]);
    await analyzeJourney(ctx(db), 'c1');
    expect(resolveDepositRule).toHaveBeenCalledTimes(1);
  });
});
