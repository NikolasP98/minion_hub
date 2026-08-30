import { beforeEach, describe, it, expect, vi } from 'vitest';
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
/** The version stamp the rebuild SNAPSHOTS with the rule it classifies under. */
let snapshotVersion: string | null = null;
vi.mock('./crm-settings.service', async () => {
  // Only the read is faked; the lock + in-transaction version read are the
  // SHIPPED ones, so the statements the publication issues are the real ones.
  const actual =
    await vi.importActual<typeof import('./crm-settings.service')>('./crm-settings.service');
  return {
    ...actual,
    resolveDepositRule: () => resolveDepositRule(),
    resolveDepositRuleWithVersion: async () => ({
      rule: await resolveDepositRule(),
      version: snapshotVersion,
    }),
  };
});

import { DEFAULT_DEPOSIT_RULE, type DepositRule } from './crm-deposit-rule';

const embeddingsEnabled = vi.fn(() => true);
const embedTexts = vi.fn<(texts: string[]) => Promise<number[][]>>(async (texts) =>
  texts.map(() => [0.1, 0.2]),
);
vi.mock('./embeddings', () => ({
  embeddingsEnabled: () => embeddingsEnabled(),
  embedText: vi.fn(async () => []),
  embedTexts: (texts: string[]) => embedTexts(texts),
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

import {
  buildWinIndex,
  getWinAnalysis,
  persistWinAnalysisIfCurrent,
} from './crm-similarity.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const dialect = new PgDialect();
const GENERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(GENERATION);
});

function createGenerationDb() {
  const result = createMockDb();
  const rawDb = result.db as unknown as { execute: (query: SQL) => Promise<unknown> };
  const original = rawDb.execute.bind(rawDb);
  rawDb.execute = vi.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.includes("value->>'winIndexGeneration'")) return [{ generation: GENERATION }];
    return original(query);
  });
  return result;
}
function executedSqlContaining(db: unknown, needle: string): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  const call = calls.find(([query]) => dialect.sqlToQuery(query as SQL).sql.includes(needle));
  expect(call).toBeDefined();
  return call![0] as SQL;
}

describe('buildWinIndex', () => {
  it('returns { indexed: 0 } when disabled', async () => {
    embeddingsEnabled.mockReturnValueOnce(false);
    const { db } = createGenerationDb();
    expect(await buildWinIndex(ctx(db))).toEqual({ indexed: 0 });
  });

  it('PARITY: the full compiled buyer query matches the shipped shape, with the deposit rule bound as a parameter', async () => {
    const { db, resolve } = createGenerationDb();
    resolve([]);
    await buildWinIndex(ctx(db));
    const { sql, params } = dialect.sqlToQuery(executedSqlContaining(db, 'from crm_contacts c'));
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
  // only proves buildWinIndex publishes an empty current set —
  // NOT that a deposit-only contact's row is excluded by `having
  // bool_or(IS_PROCEDURE)`. That predicate (shared with crm-finance.service.ts
  // and crm-journey.service.ts) is proven against real PostgreSQL, seeded with
  // a deposit-only description row, in crm-deposit-rule.sql.integration.test.ts.
  it('MAPPING: returns { indexed: 0 } when the buyer query returns no rows', async () => {
    const { db, resolve } = createGenerationDb();
    resolve([]);
    const result = await buildWinIndex(ctx(db));
    expect(result).toEqual({ indexed: 0 });
    const deleteQuery = dialect.sqlToQuery(
      executedSqlContaining(db, 'delete from crm_win_embeddings'),
    );
    expect(deleteQuery.sql).toContain('contact_id <> all(array[]::uuid[])');
    expect(
      dialect.sqlToQuery(executedSqlContaining(db, "value = coalesce(value, '{}'::jsonb)")).sql,
    ).toContain("- 'winAnalysis'");
  });
});

describe('per-org deposit rule (S2 — crm_settings.value.deposit decides what counts as "bought")', () => {
  it('the org’s vocabulary is bound into both the filter and the HAVING clause', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: ['adelanto', 'seña'], label: 'Adelanto' });
    const { db, resolve } = createGenerationDb();
    resolve([]);
    await buildWinIndex(ctx(db));
    const { sql, params } = dialect.sqlToQuery(executedSqlContaining(db, 'from crm_contacts c'));
    expect(sql).toContain(
      'filter (where (ii.description is not null and coalesce((ii.description not ilike $1 and ii.description not ilike $2), true)))',
    );
    expect(sql).toContain(
      'having bool_or((ii.description is not null and coalesce((ii.description not ilike $3 and ii.description not ilike $4), true)))',
    );
    expect(params).toEqual(['%adelanto%', '%seña%', '%adelanto%', '%seña%']);
  });

  it('an org with NO deposit concept (keywords: []) treats every described line as bought', async () => {
    resolveDepositRule.mockResolvedValueOnce({ keywords: [], label: 'x' });
    const { db, resolve } = createGenerationDb();
    resolve([]);
    await buildWinIndex(ctx(db));
    const { sql, params } = dialect.sqlToQuery(executedSqlContaining(db, 'from crm_contacts c'));
    expect(sql).toContain('filter (where (ii.description is not null and true))');
    expect(params).toEqual([]);
  });

  it('the rule is resolved ONCE per rebuild — not once per buyer', async () => {
    resolveDepositRule.mockClear();
    const { db, resolve } = createGenerationDb();
    resolve([]);
    await buildWinIndex(ctx(db));
    expect(resolveDepositRule).toHaveBeenCalledTimes(1);
  });
});

/**
 * Publication ordering (⚠️ A3 of 2026-08-17-hub-reserva-keyword-config-spec).
 *
 * `buildWinIndex` classifies buyers under the rule it read at the START of the
 * pass, then leaves the database for the embedding round-trips, then writes
 * `bought`/`snippet` with `built_at = now()`. An operator changing the rule in
 * that window used to get the worst of both: rows derived from the OLD
 * vocabulary carrying a timestamp NEWER than the new rule's `updatedAt`, so
 * `writeDepositRule`'s `built_at < updatedAt` disclosure reported them fresh.
 *
 * The tests below drive that exact interleaving — the mocked `embedTexts`
 * stands in for the concurrent `PUT /api/crm/settings`, flipping the stored
 * version while the pass is embedding — through the SHIPPED publication path.
 */
describe('win-index publication vs a concurrent deposit-rule write', () => {
  const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

  /** A mock db that answers each of buildWinIndex's statements by shape and
   *  records the SQL it was asked to run, in order. */
  function routedDb(liveVersion: () => string | null) {
    const { db } = createMockDb();
    const executed: string[] = [];
    const execute = vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      if (/^\s*(set local|select set_config)/i.test(text)) return undefined;
      executed.push(text);
      if (text.includes('from crm_contacts c')) return [{ id: CONTACT_ID, bought: ['botox'] }];
      if (text.includes('join messages m'))
        return [
          { contact_id: CONTACT_ID, direction: 'in', content: 'hola', at: '2026-08-01T00:00:00Z' },
        ];
      if (text.includes("value #>> '{deposit,updatedAt}'")) return [{ version: liveVersion() }];
      if (text.includes("value->>'winIndexGeneration'")) return [{ generation: GENERATION }];
      return [];
    });
    (db as unknown as { execute: unknown }).execute = execute;
    return { db, executed };
  }

  const publishSql = (executed: string[]) =>
    executed.filter((t) => t.includes('insert into crm_win_embeddings'));

  it('discards the pass when the rule changed while it was embedding — nothing is published', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshotVersion = '2026-08-29T09:00:00.000Z';
    let live: string | null = snapshotVersion;
    // The concurrent PUT lands here: after classification, before publication.
    embedTexts.mockImplementationOnce(async (texts) => {
      live = '2026-08-29T09:00:05.000Z';
      return texts.map(() => [0.1, 0.2]);
    });
    const { db, executed } = routedDb(() => live);

    const result = await buildWinIndex(ctx(db));

    expect(result).toEqual({ indexed: 0, skipped: 'rule-changed' });
    expect(publishSql(executed)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('changed during the win-index'));
    warn.mockRestore();
  });

  it('publishes when the rule is unchanged, holding the deposit-config lock across the recheck and the upsert', async () => {
    snapshotVersion = '2026-08-29T09:00:00.000Z';
    const { db, executed } = routedDb(() => snapshotVersion);

    const result = await buildWinIndex(ctx(db));

    expect(result).toEqual({ indexed: 1 });
    const lockAt = executed.findIndex((t) => t.includes('pg_advisory_xact_lock'));
    const recheckAt = executed.findIndex((t) => t.includes("value #>> '{deposit,updatedAt}'"));
    const upsertAt = executed.findIndex((t) => t.includes('insert into crm_win_embeddings'));
    const deleteAt = executed.findIndex((t) => t.includes('delete from crm_win_embeddings'));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    // The lock is what makes the recheck and the upsert one indivisible step
    // against writeDepositRule — a recheck taken before it would be advisory.
    expect(lockAt).toBeLessThan(recheckAt);
    expect(recheckAt).toBeLessThan(deleteAt);
    expect(deleteAt).toBeLessThan(upsertAt);
    expect(recheckAt).toBeLessThan(upsertAt);
  });

  it('preserves the previous complete index when embedding fails', async () => {
    snapshotVersion = '2026-08-29T09:00:00.000Z';
    embedTexts.mockRejectedValueOnce(new Error('provider unavailable'));
    const { db, executed } = routedDb(() => snapshotVersion);

    expect(await buildWinIndex(ctx(db))).toEqual({ indexed: 0 });
    expect(executed.some((t) => t.includes('delete from crm_win_embeddings'))).toBe(false);
    expect(publishSql(executed)).toHaveLength(0);
  });

  it('an org that never configured a rule (version null on both sides) still publishes', async () => {
    snapshotVersion = null;
    const { db, executed } = routedDb(() => null);

    expect(await buildWinIndex(ctx(db))).toEqual({ indexed: 1 });
    expect(publishSql(executed)).toHaveLength(1);
  });

  it('a rule configured while an unversioned pass was in flight discards that pass', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshotVersion = null; // read fell back to the default rule…
    const { db, executed } = routedDb(() => '2026-08-29T09:00:05.000Z'); // …org is configured now
    expect(await buildWinIndex(ctx(db))).toEqual({ indexed: 0, skipped: 'rule-changed' });
    expect(publishSql(executed)).toHaveLength(0);
    warn.mockRestore();
  });

  it('discards an older same-rule snapshot after a newer rebuild has published', async () => {
    const OLD_GENERATION = '11111111-1111-4111-8111-111111111111';
    const NEW_GENERATION = '22222222-2222-4222-8222-222222222222';
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(OLD_GENERATION)
      .mockReturnValueOnce(NEW_GENERATION);
    snapshotVersion = '2026-08-29T09:00:00.000000Z';

    let liveGeneration: string | null = null;
    let buyerRead = 0;
    let releaseOlder!: () => void;
    const olderEmbeddingBlocked = new Promise<void>((resolve) => (releaseOlder = resolve));
    let olderReachedEmbedding!: () => void;
    const olderAtEmbedding = new Promise<void>((resolve) => (olderReachedEmbedding = resolve));
    embedTexts
      .mockImplementationOnce(async (texts) => {
        olderReachedEmbedding();
        await olderEmbeddingBlocked;
        return texts.map(() => [0.1, 0.2]);
      })
      .mockImplementationOnce(async (texts) => texts.map(() => [0.3, 0.4]));

    const { db } = createMockDb();
    const executed: string[] = [];
    (db as unknown as { execute: unknown }).execute = vi.fn(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      const text = compiled.sql;
      if (/^\s*(set local|select set_config)/i.test(text)) return undefined;
      executed.push(text);
      if (text.includes("jsonb_build_object('winIndexGeneration'")) {
        liveGeneration = String(compiled.params[1]);
        return [];
      }
      if (text.includes('from crm_contacts c')) {
        buyerRead += 1;
        return buyerRead === 1
          ? [{ id: CONTACT_ID, bought: ['botox'] }]
          : [
              { id: CONTACT_ID, bought: ['botox'] },
              { id: '22222222-2222-4222-8222-222222222223', bought: ['laser'] },
            ];
      }
      if (text.includes('join messages m')) {
        const ids =
          buyerRead === 1 ? [CONTACT_ID] : [CONTACT_ID, '22222222-2222-4222-8222-222222222223'];
        return ids.map((contact_id) => ({
          contact_id,
          direction: 'in',
          content: 'hola',
          at: '2026-08-01T00:00:00Z',
        }));
      }
      if (text.includes("value->>'winIndexGeneration'")) return [{ generation: liveGeneration }];
      if (text.includes("value #>> '{deposit,updatedAt}'")) return [{ version: snapshotVersion }];
      return [];
    });

    const older = buildWinIndex(ctx(db));
    await olderAtEmbedding;
    const newer = await buildWinIndex(ctx(db));
    releaseOlder();

    expect(newer).toEqual({ indexed: 2 });
    expect(await older).toEqual({ indexed: 0, skipped: 'newer-build' });
    expect(executed.filter((text) => text.includes('delete from crm_win_embeddings'))).toHaveLength(
      1,
    );
  });
});

describe('win-analysis publication vs a concurrent deposit-rule write', () => {
  const analysis = {
    wins: [{ point: 'x', repeat: 'y' }],
    improvements: [],
    builtAt: '2026-08-29T09:01:00.000Z',
    basedOn: 1,
  };

  it('does not persist an old-rule analysis after the live version changes', async () => {
    const { db } = createMockDb();
    const execute = vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("value #>> '{deposit,updatedAt}'")) {
        return [{ version: '2026-08-29T09:00:05.000Z' }];
      }
      return [];
    });
    (db as unknown as { execute: unknown }).execute = execute;

    expect(
      await persistWinAnalysisIfCurrent(ctx(db), analysis, '2026-08-29T09:00:00.000Z', GENERATION),
    ).toBe(false);
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });

  it('holds the lock through the version check and current-analysis write', async () => {
    const version = '2026-08-29T09:00:00.000Z';
    const { db } = createMockDb();
    const executed: string[] = [];
    const execute = vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      executed.push(text);
      if (text.includes("value #>> '{deposit,updatedAt}'")) return [{ version }];
      if (text.includes("value->>'winIndexGeneration'")) return [{ generation: GENERATION }];
      return [];
    });
    (db as unknown as { execute: unknown }).execute = execute;

    expect(await persistWinAnalysisIfCurrent(ctx(db), analysis, version, GENERATION)).toBe(true);
    expect(executed.findIndex((t) => t.includes('pg_advisory_xact_lock'))).toBeLessThan(
      executed.findIndex((t) => t.includes("value #>> '{deposit,updatedAt}'")),
    );
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledTimes(1);
  });

  it('refuses to serve an analysis from a previous rebuild generation', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        value: {
          winIndexGeneration: GENERATION,
          winAnalysis: { ...analysis, generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        },
      },
    ]);
    expect(await getWinAnalysis(ctx(db))).toBeNull();
  });
});
