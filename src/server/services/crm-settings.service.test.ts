import { describe, it, expect, vi, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockDb } from '$server/test-utils/mock-db';
import { DEFAULT_DEPOSIT_RULE, DEPOSIT_KEYWORDS_MAX, depositMatchSql } from './crm-deposit-rule';
import { readCrmSettingsValue, resolveDepositRule } from './crm-settings.service';

/**
 * The REAL settings read path (query + graceful default + normalization),
 * driven by a mock db that returns real `crm_settings.value` blobs. The three
 * consumer services mock `resolveDepositRule` out to test their own threading;
 * this file is where the resolution itself is proven.
 */

const dialect = new PgDialect();
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

/** A ctx whose db rejects every transaction — stands in for the missing
 *  `crm_settings` relation the migration's header promises to survive. */
const brokenCtx = () => ({
  db: {
    transaction: () => Promise.reject(new Error('relation "crm_settings" does not exist')),
  } as never,
  tenantId: 'org-1',
});

afterEach(() => vi.restoreAllMocks());

describe('readCrmSettingsValue', () => {
  it('returns the stored jsonb document for the org', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { disabled_channels: ['instagram'], deposit: { keywords: ['dep'] } } }]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({
      disabled_channels: ['instagram'],
      deposit: { keywords: ['dep'] },
    });
  });

  it('returns {} when the org has no settings row', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await readCrmSettingsValue(ctx(db))).toEqual({});
  });

  it('honours the migration’s graceful default: a missing relation is swallowed, not thrown', async () => {
    await expect(readCrmSettingsValue(brokenCtx())).resolves.toEqual({});
  });
});

describe('resolveDepositRule', () => {
  it('ABSENT: no settings row at all ⇒ the default rule (today’s behaviour for every org)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('ABSENT: a settings row with other keys but no `deposit` ⇒ the default rule', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { disabled_channels: ['whatsapp'] } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual(DEFAULT_DEPOSIT_RULE);
  });

  it('CONFIGURED: the org’s own vocabulary, normalized', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: ['  Adelanto', 'SEÑA'], label: 'Adelanto' } } }]);
    expect(await resolveDepositRule(ctx(db))).toEqual({
      keywords: ['adelanto', 'seña'],
      label: 'Adelanto',
    });
  });

  it('EXPLICITLY EMPTY: keywords: [] is a configuration, not a fallback — nothing is a deposit', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: [], label: 'x' } } }]);
    const rule = await resolveDepositRule(ctx(db));
    expect(rule).toEqual({ keywords: [], label: 'x' });
    // …and the predicate built from it is a hard `false`, never a dropped clause.
    expect(dialect.sqlToQuery(depositMatchSql('ii.description', rule)).sql).toBe('false');
  });

  it(`caps a hand-written over-long keyword list at ${DEPOSIT_KEYWORDS_MAX}`, async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit: { keywords: Array.from({ length: 40 }, (_, i) => `kw${i}`) } } }]);
    const rule = await resolveDepositRule(ctx(db));
    expect(dialect.sqlToQuery(depositMatchSql('ii.description', rule)).params).toHaveLength(
      DEPOSIT_KEYWORDS_MAX,
    );
  });

  it.each([
    ['a bare string', 'reserva'],
    ['non-string members', { keywords: [1, 2] }],
  ])('MALFORMED (%s): warns and falls back to the default — never throws', async (_n, deposit) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, resolve } = createMockDb();
    resolve([{ value: { deposit } }]);
    await expect(resolveDepositRule(ctx(db))).resolves.toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('org-1');
  });

  it('a read failure (missing relation) falls back to the default without warning about a malformed blob', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(resolveDepositRule(brokenCtx())).resolves.toEqual(DEFAULT_DEPOSIT_RULE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is read fresh on every call — no in-process cache to go stale after a rule change', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ value: { deposit: { keywords: ['adelanto'] } } }],
      [{ value: { deposit: { keywords: ['deposit'] } } }],
    ]);
    expect((await resolveDepositRule(ctx(db))).keywords).toEqual(['adelanto']);
    expect((await resolveDepositRule(ctx(db))).keywords).toEqual(['deposit']);
  });
});
