import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { normalizeSql } from '$server/test-utils/normalize-sql';

const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));

const embeddingsEnabled = vi.fn(() => true);
vi.mock('./embeddings', () => ({
  embeddingsEnabled: () => embeddingsEnabled(),
  embedText: vi.fn(async () => []),
  embedTexts: vi.fn(async () => []),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

import { buildWinIndex } from './crm-similarity.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const dialect = new PgDialect();
function lastExecutedSql(db: unknown): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  return calls[calls.length - 1][0] as SQL;
}

describe('buildWinIndex', () => {
  it('returns { indexed: 0 } when disabled', async () => {
    embeddingsEnabled.mockReturnValueOnce(false);
    const { db } = createMockDb();
    expect(await buildWinIndex(ctx(db))).toEqual({ indexed: 0 });
  });

  it('PARITY: the full compiled buyer query matches the shipped shape, with the deposit rule bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no buyers → buildWinIndex short-circuits right after this query
    await buildWinIndex(ctx(db));
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `select c.id::text id,
               array_agg(distinct ii.description) filter (where (ii.description is not null and coalesce((ii.description not ilike $1), true))) bought
        from crm_contacts c
        join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = c.party_id
        join fin_invoices fi on fi.client_id = fc.id
        join fin_invoice_items ii on ii.invoice_id = fi.id
        where c.org_id = current_setting('app.current_org_id', true) and c.party_id is not null
        group by c.id
        having bool_or((ii.description is not null and coalesce((ii.description not ilike $2), true)))`,
      ),
    );
    expect(params).toEqual(['%reserva%', '%reserva%']);
  });

  // MAPPING, not classification: the mock returns zero rows directly, so this
  // only proves buildWinIndex short-circuits on an empty buyerRows result —
  // NOT that a deposit-only contact's row is excluded by `having
  // bool_or(IS_PROCEDURE)`. That predicate (shared with crm-finance.service.ts
  // and crm-journey.service.ts) is proven against real PostgreSQL, seeded with
  // a deposit-only description row, in crm-deposit-rule.sql.integration.test.ts.
  it('MAPPING: returns { indexed: 0 } when the buyer query returns no rows', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await buildWinIndex(ctx(db));
    expect(result).toEqual({ indexed: 0 });
  });
});
