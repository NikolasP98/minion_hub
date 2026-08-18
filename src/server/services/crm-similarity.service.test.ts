import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';

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

  it('PARITY: the buyer query ILIKE-excludes the deposit rule keyword, bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no buyers → buildWinIndex short-circuits right after this query
    await buildWinIndex(ctx(db));
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(sql).toContain(
      "array_agg(distinct ii.description) filter (where (ii.description is not null and (ii.description not ilike $1))) bought",
    );
    expect(sql).toContain(
      "having bool_or((ii.description is not null and (ii.description not ilike $2)))",
    );
    expect(params).toEqual(['%reserva%', '%reserva%']);
  });

  it('POLARITY: a buyer with only a deposit line (no procedure) is excluded — no buyers indexed', async () => {
    const { db, resolve } = createMockDb();
    // The `having bool_or(IS_PROCEDURE)` clause means a contact whose only line
    // items are deposits never appears in buyerRows at all.
    resolve([]);
    const result = await buildWinIndex(ctx(db));
    expect(result).toEqual({ indexed: 0 });
  });
});
