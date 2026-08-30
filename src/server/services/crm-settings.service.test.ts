import { describe, it, expect, vi, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  normalizeDepositRule,
  readCrmSettingsValue,
  resolveDepositRule,
  resolveDepositRuleWithVersion,
  writeDepositRule,
} from './crm-settings.service';
import { DEFAULT_DEPOSIT_RULE, DEPOSIT_KEYWORDS_MAX } from './crm-deposit-rule';

const dialect = new PgDialect();

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

/**
 * Real-query sequencing for raw `tx.execute` calls, skipping `withOrgCore`'s
 * fixed setup statements so `values` only has to list results for
 * writeDepositRule's own queries — the advisory lock, current-rule read,
 * `clock_timestamp()` stamp, upsert, then stale-count select — same technique
 * as `pos.sellables.test.ts`'s
 * `mockExecuteSeq`.
 */
function mockExecuteSeq(db: unknown, values: unknown[]) {
  const queue = [...values];
  const isSetupQuery = (query: unknown): boolean => {
    const chunks = (query as { queryChunks?: unknown[] } | undefined)?.queryChunks;
    const first = chunks?.[0] as { value?: unknown } | string | undefined;
    const text =
      typeof first === 'string' ? first : Array.isArray(first?.value) ? first.value.join(' ') : '';
    return /^\s*(set local|select set_config)/i.test(text);
  };
  (db as { execute: unknown }).execute = vi.fn((query: unknown) =>
    isSetupQuery(query) ? Promise.resolve(undefined) : Promise.resolve(queue.shift()),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spy that also silences the warning so a passing run stays readable. */
function warnSpy() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/** The database clock every writeDepositRule test below answers
 *  `select clock_timestamp()` with — deliberately NOT close to this process's
 *  clock, so any stamp taken from `new Date()` instead of the DB is visible. */
const DB_CLOCK = '2031-03-04T05:06:07.089Z';

/** Results for a classification-changing write's five statements, in order. */
function writeSeq(staleCount: number) {
  return [undefined, [], [{ at: DB_CLOCK }], undefined, [{ count: staleCount }]];
}

function equivalentWriteSeq(deposit: unknown) {
  return [undefined, [{ deposit }], [{ at: DB_CLOCK }], undefined];
}

const executeOf = (db: unknown) => (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute;

/** Rendered SQL text of every non-setup statement the service issued, in order. */
function executedSql(db: unknown): string[] {
  return executeOf(db)
    .mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL).sql)
    .filter((text) => !/^\s*(set local|select set_config)/i.test(text));
}

/** Bound parameters of the first executed statement whose SQL contains `needle`. */
function paramsOf(db: unknown, needle: string): unknown[] {
  const call = executeOf(db).mock.calls.find((c) =>
    dialect.sqlToQuery(c[0] as SQL).sql.includes(needle),
  );
  expect(call).toBeDefined();
  return dialect.sqlToQuery(call![0] as SQL).params;
}

describe('readCrmSettingsValue', () => {
  it('returns the stored value object', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [], deposit: { keywords: ['x'] } } }]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({
      accounts: [],
      deposit: { keywords: ['x'] },
    });
  });

  it('returns {} when the org has no crm_settings row', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({});
  });

  it('propagates a read failure so each caller applies its own fallback', async () => {
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    await expect(readCrmSettingsValue(ctx(db))).rejects.toThrow('boom');
  });
});

// The normalization contract is the settings boundary's whole job — the SQL
// built downstream binds whatever comes out of here, so each rule below is
// asserted on its own rather than through one happy-path fixture.
describe('normalizeDepositRule', () => {
  it('treats an absent deposit key as "unconfigured": the default rule, no warning', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule(undefined)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(normalizeDepositRule(null)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a bare string', 'reserva'],
    ['an array', ['reserva']],
    ['a number', 7],
  ])('warns and falls back for a deposit value that is %s', (_label, raw) => {
    const warn = warnSpy();
    expect(normalizeDepositRule(raw)).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back when keywords is not an array', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: 'reserva', label: 'x' })).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back for a MIXED array rather than silently activating its string members', () => {
    const warn = warnSpy();
    // The dangerous case: salvaging ['adelanto'] here would put an active rule
    // in production that the operator never wrote.
    expect(normalizeDepositRule({ keywords: [' adelanto ', 42] })).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back when the label is not a string', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: ['adelanto'], label: 3 })).toEqual(
      DEFAULT_DEPOSIT_RULE,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('trims and lowercases keywords — surrounding whitespace never reaches the ILIKE pattern', () => {
    // ' Adelanto ' compiled verbatim would be '% adelanto %' and would fail to
    // match an ordinary "Adelanto de cita" line.
    expect(normalizeDepositRule({ keywords: [' Adelanto ', 'SEÑA'] })).toEqual({
      keywords: ['adelanto', 'seña'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it('dedupes stably — first occurrence wins, case/whitespace variants collapse', () => {
    expect(
      normalizeDepositRule({ keywords: ['adelanto', 'seña', 'ADELANTO', ' adelanto'] }).keywords,
    ).toEqual(['adelanto', 'seña']);
  });

  it('drops blank entries without treating them as malformed', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: ['adelanto', '   ', ''] }).keywords).toEqual([
      'adelanto',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('truncates every keyword to 40 characters so one entry cannot become an unbounded SQL parameter', () => {
    const long = 'a'.repeat(200);
    const { keywords } = normalizeDepositRule({ keywords: [long] });
    expect(keywords).toEqual(['a'.repeat(40)]);
  });

  it('truncates the label to 40 characters too', () => {
    const { label } = normalizeDepositRule({ keywords: [], label: 'b'.repeat(200) });
    expect(label).toBe('b'.repeat(40));
  });

  it(`caps the keyword list at ${DEPOSIT_KEYWORDS_MAX} entries and warns about the ones it drops`, () => {
    const warn = warnSpy();
    const many = Array.from({ length: 50 }, (_v, i) => `kw${i}`);
    const { keywords } = normalizeDepositRule({ keywords: many });
    expect(keywords).toHaveLength(DEPOSIT_KEYWORDS_MAX);
    expect(keywords[0]).toBe('kw0');
    expect(keywords.at(-1)).toBe(`kw${DEPOSIT_KEYWORDS_MAX - 1}`);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('honors an explicitly empty keyword array — not absent, not malformed', () => {
    const warn = warnSpy();
    expect(normalizeDepositRule({ keywords: [], label: 'None' })).toEqual({
      keywords: [],
      label: 'None',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores sibling keys it does not own — including the updatedAt the write path stamps', () => {
    // `crm_settings.value.deposit` is written by a strict schema that owns
    // `updatedAt`; the read side must not choke on it, nor on a key added by a
    // later slice, nor let either leak into the rule the SQL binds.
    const warn = warnSpy();
    expect(
      normalizeDepositRule({ keywords: ['adelanto'], updatedAt: '2026-08-20T00:00:00Z', next: 1 }),
    ).toEqual({ keywords: ['adelanto'], label: DEFAULT_DEPOSIT_RULE.label });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default label when the stored label is missing or blank', () => {
    expect(normalizeDepositRule({ keywords: ['adelanto'] }).label).toBe(DEFAULT_DEPOSIT_RULE.label);
    expect(normalizeDepositRule({ keywords: ['adelanto'], label: '  ' }).label).toBe(
      DEFAULT_DEPOSIT_RULE.label,
    );
  });
});

describe('resolveDepositRule', () => {
  it('falls back to DEFAULT_DEPOSIT_RULE when no crm_settings row exists', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('falls back to DEFAULT_DEPOSIT_RULE when the deposit key is absent', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [] } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('returns the normalized stored rule', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: [' Adelanto ', 'seña'], label: 'Adelanto' } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual({
      keywords: ['adelanto', 'seña'],
      label: 'Adelanto',
    });
  });

  it('warns and falls back to DEFAULT_DEPOSIT_RULE when the read throws', async () => {
    const warn = warnSpy();
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// S3 of 2026-08-17-hub-reserva-keyword-config-spec: the validated write path.
describe('writeDepositRule', () => {
  it('merges the deposit key via one insert-on-conflict statement — sibling keys untouched by construction', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));

    await writeDepositRule(ctx(db), { keywords: ['adelanto'] });

    const execute = (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
    const sqlText = (query: unknown) =>
      ((query as { queryChunks?: Array<{ value?: string[] }> }).queryChunks ?? [])
        .map((c) => c.value?.join(' ') ?? '')
        .join(' ');
    const upsertCall = execute.mock.calls.find((c) =>
      sqlText(c[0]).includes('insert into crm_settings'),
    );
    expect(upsertCall).toBeDefined();
    // Only `value || jsonb_build_object('deposit', …)` — never `value = $1`,
    // which is the exact bug (replacing, not merging) this slice must avoid.
    const upsertSql = sqlText(upsertCall![0]);
    expect(upsertSql).toContain('||');
    expect(upsertSql).toContain("jsonb_build_object('deposit'");
  });

  it('stamps updatedAt server-side and returns the normalized rule', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));

    const result = await writeDepositRule(ctx(db), { keywords: ['ADELANTO', ' seña '] });

    expect(result.rule).toEqual({
      keywords: ['adelanto', 'seña'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it('staleDerivedCount reflects crm_win_embeddings rows built before this update; 0 ⇒ staleDerived false', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));
    const clean = await writeDepositRule(ctx(db), { keywords: ['adelanto'] });
    expect(clean).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });

    const { db: db2 } = createMockDb();
    mockExecuteSeq(db2, writeSeq(7));
    const stale = await writeDepositRule(ctx(db2), { keywords: ['adelanto'] });
    expect(stale).toMatchObject({ staleDerived: true, staleDerivedCount: 7 });
  });

  it('an empty keywords array is a legitimate write (matches nothing), not rejected', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));
    const result = await writeDepositRule(ctx(db), { keywords: [] });
    expect(result.rule.keywords).toEqual([]);
  });

  // The stale-derived disclosure is only sound if a win-index publication
  // cannot land between the cutoff stamp and the count. These two tests pin
  // the two halves of that: the lock comes first, and the cutoff is the
  // DATABASE's clock read after it.
  it('takes the org deposit-config lock BEFORE stamping or writing anything', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));

    await writeDepositRule(ctx(db), { keywords: ['adelanto'] });

    const statements = executedSql(db);
    expect(statements[0]).toContain("pg_advisory_xact_lock(hashtext('crm-deposit-rule:'");
    expect(statements[1]).toContain("value->'deposit'");
    expect(statements[2]).toContain('clock_timestamp()');
    expect(statements[3]).toContain('insert into crm_settings');
    expect(statements[4]).toContain('from crm_win_embeddings');
    // Waits for the lock — a `try_` variant would let the write proceed while
    // a rebuild is publishing, which is exactly the ordering being bought.
    expect(statements[0]).not.toContain('try_advisory');
    expect(paramsOf(db, 'pg_advisory_xact_lock')).toEqual(['org-1']);
  });

  it('stamps updatedAt and the staleness cutoff from the DATABASE clock, not this process clock', async () => {
    const { db } = createMockDb();
    mockExecuteSeq(db, writeSeq(0));

    await writeDepositRule(ctx(db), { keywords: ['adelanto'] });

    // Stored blob: the DB clock's instant, not `new Date()`.
    const [, storedJson] = paramsOf(db, 'insert into crm_settings') as [string, string];
    expect(JSON.parse(storedJson).updatedAt).toBe(DB_CLOCK);
    // …and the same instant bounds the stale-row count, so the two can never
    // be compared across two different clocks.
    expect(paramsOf(db, 'from crm_win_embeddings')).toEqual(['org-1', DB_CLOCK]);
  });

  it('an identical normalized retry preserves the classification version and reports no stale rows', async () => {
    const version = '2029-01-02T03:04:05.000Z';
    const { db } = createMockDb();
    mockExecuteSeq(
      db,
      equivalentWriteSeq({ keywords: ['ADELANTO'], label: 'Reserva', updatedAt: version }),
    );

    const result = await writeDepositRule(ctx(db), { keywords: [' adelanto '] });

    expect(result).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });
    const [, storedJson] = paramsOf(db, 'insert into crm_settings') as [string, string];
    expect(JSON.parse(storedJson).updatedAt).toBe(version);
    expect(executedSql(db).some((text) => text.includes('from crm_win_embeddings'))).toBe(false);
  });

  it('a label-only update preserves the classification version and reports no stale rows', async () => {
    const version = '2029-01-02T03:04:05.000Z';
    const { db } = createMockDb();
    mockExecuteSeq(
      db,
      equivalentWriteSeq({ keywords: ['seña', 'adelanto'], label: 'Old', updatedAt: version }),
    );

    const result = await writeDepositRule(ctx(db), {
      keywords: ['ADELANTO', 'SEÑA'],
      label: 'New label',
    });

    expect(result).toMatchObject({
      rule: { keywords: ['adelanto', 'seña'], label: 'New label' },
      staleDerived: false,
      staleDerivedCount: 0,
    });
    const [, storedJson] = paramsOf(db, 'insert into crm_settings') as [string, string];
    expect(JSON.parse(storedJson).updatedAt).toBe(version);
  });
});

// The version stamp `buildWinIndex` snapshots and rechecks (see
// crm-similarity.service.test.ts's publication tests).
describe('resolveDepositRuleWithVersion', () => {
  it('returns the stored updatedAt as the version alongside the normalized rule', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { value: { deposit: { keywords: ['Adelanto'], updatedAt: '2026-08-29T09:00:00.000Z' } } },
    ]);
    expect(await resolveDepositRuleWithVersion(ctx(db))).toEqual({
      rule: { keywords: ['adelanto'], label: DEFAULT_DEPOSIT_RULE.label },
      version: '2026-08-29T09:00:00.000Z',
    });
  });

  it('an org with no stored rule (and a rule with no stamp) is version null', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: {} }]);
    expect(await resolveDepositRuleWithVersion(ctx(db))).toEqual({
      rule: DEFAULT_DEPOSIT_RULE,
      version: null,
    });

    const { db: db2, resolve: resolve2 } = createMockDb();
    resolve2([{ value: { deposit: { keywords: ['adelanto'] } } }]);
    expect((await resolveDepositRuleWithVersion(ctx(db2))).version).toBeNull();
  });

  it('a failed read is version null — the same version an unconfigured org has', async () => {
    const warn = warnSpy();
    const db = {
      transaction: () => {
        throw new Error('boom');
      },
    } as never;
    expect(await resolveDepositRuleWithVersion(ctx(db))).toEqual({
      rule: DEFAULT_DEPOSIT_RULE,
      version: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
