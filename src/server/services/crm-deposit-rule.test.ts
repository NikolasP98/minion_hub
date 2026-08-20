import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  depositMatchSql,
  depositSortKeySql,
  depositWriteSchema,
  notDepositMatchSql,
  escapeLikePattern,
  isDepositText,
  type DepositRule,
} from './crm-deposit-rule';
import { DEPOSIT_TEXT_CASES } from './crm-deposit-rule.fixtures';

const dialect = new PgDialect();
const render = (frag: ReturnType<typeof depositMatchSql>) => dialect.sqlToQuery(frag);

describe('DEFAULT_DEPOSIT_RULE', () => {
  it('is the FACES-era default — the only occurrence of "reserva" outside this module/tests', () => {
    expect(DEFAULT_DEPOSIT_RULE).toEqual({
      keywords: ['reserva'],
      // The exact caption crm-journey.service.ts hardcoded before the rule
      // existed, so an org with no crm_settings.value.deposit row keeps
      // byte-identical output (S2 zero-regression clause).
      label: 'Reserved a consult',
    });
  });
});

describe('escapeLikePattern', () => {
  it('wraps the keyword in %…%', () => {
    expect(escapeLikePattern('reserva')).toBe('%reserva%');
  });

  it('escapes %, _ and \\ so operator input can never widen into a wildcard', () => {
    expect(escapeLikePattern('100%')).toBe('%100\\%%');
    expect(escapeLikePattern('a_b')).toBe('%a\\_b%');
    expect(escapeLikePattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('depositMatchSql / notDepositMatchSql', () => {
  it('single-keyword rule renders one bound ILIKE clause, coalesced to a total boolean', () => {
    const { sql, params } = render(depositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('coalesce((ii.description ilike $1), false)');
    expect(params).toEqual(['%reserva%']);
  });

  it('notDepositMatchSql renders the negated, bound clause, coalesced to a total boolean', () => {
    const { sql, params } = render(notDepositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('coalesce((ii.description not ilike $1), true)');
    expect(params).toEqual(['%reserva%']);
  });

  it('multi-keyword rule ORs deposit matches and ANDs non-matches', () => {
    const rule: DepositRule = { keywords: ['adelanto', 'seña'], label: 'Adelanto' };
    const pos = render(depositMatchSql('ii.description', rule));
    expect(pos.sql).toBe('coalesce((ii.description ilike $1 or ii.description ilike $2), false)');
    expect(pos.params).toEqual(['%adelanto%', '%seña%']);

    const neg = render(notDepositMatchSql('ii.description', rule));
    expect(neg.sql).toBe(
      'coalesce((ii.description not ilike $1 and ii.description not ilike $2), true)',
    );
    expect(neg.params).toEqual(['%adelanto%', '%seña%']);
  });

  it('empty keywords ⇒ depositMatchSql is `false` and notDepositMatchSql is `true` — never undefined', () => {
    const rule: DepositRule = { keywords: [], label: 'x' };
    const pos = depositMatchSql('ii.description', rule);
    const neg = notDepositMatchSql('ii.description', rule);
    expect(pos).toBeDefined();
    expect(neg).toBeDefined();
    expect(render(pos)).toMatchObject({ sql: 'false', params: [] });
    expect(render(neg)).toMatchObject({ sql: 'true', params: [] });
  });
});

describe('depositSortKeySql', () => {
  it('wraps the predicate in a CASE so a keyword rule sorts procedures (0) before deposits (1)', () => {
    const { sql, params } = render(depositSortKeySql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('(case when coalesce((ii.description ilike $1), false) then 1 else 0 end)');
    expect(params).toEqual(['%reserva%']);
  });

  it('stays a CASE for a ZERO-keyword rule — `order by false` is a PostgreSQL 42601', () => {
    // This is the whole reason the helper exists: depositMatchSql compiles an
    // empty rule to the literal `false`, which PostgreSQL rejects as a sort
    // key ("non-integer constant in ORDER BY"). Every ORDER BY on deposit-ness
    // goes through here, so an org that configured `keywords: []` still gets a
    // query that runs.
    const { sql, params } = render(
      depositSortKeySql('ii.description', { keywords: [], label: 'x' }),
    );
    expect(sql).toBe('(case when false then 1 else 0 end)');
    expect(params).toEqual([]);
  });
});

describe('isDepositText', () => {
  const rule = DEFAULT_DEPOSIT_RULE;

  // Same cases as crm-deposit-rule.sql.integration.test.ts, which evaluates
  // depositMatchSql/notDepositMatchSql against real PostgreSQL ILIKE for this
  // exact table — that test is where isDepositText's agreement with the SQL
  // side is actually established; this one only proves the TS function itself.
  it.each(DEPOSIT_TEXT_CASES)('isDepositText(%j) → %s', (text, expected) => {
    expect(isDepositText(text, rule)).toBe(expected);
  });

  it('treats null/undefined as non-deposit — the same total-boolean contract depositMatchSql/notDepositMatchSql coalesce a NULL column to (see crm-deposit-rule.sql.integration.test.ts for the real-Postgres agreement)', () => {
    expect(isDepositText(null, rule)).toBe(false);
    expect(isDepositText(undefined, rule)).toBe(false);
  });
});

describe('isDepositText with multiple keywords', () => {
  const rule: DepositRule = { keywords: ['adelanto', 'seña', 'abono'], label: 'Adelanto' };
  it('matches any configured keyword', () => {
    expect(isDepositText('ADELANTO 50%', rule)).toBe(true);
    expect(isDepositText('dejó una seña', rule)).toBe(true);
    expect(isDepositText('Reserva de Consulta', rule)).toBe(false);
  });
});

describe('depositWriteSchema (the WRITE boundary — strict, rejects instead of clamping)', () => {
  it('accepts a valid rule, including an explicitly empty keyword list', () => {
    expect(
      depositWriteSchema.safeParse({ keywords: ['adelanto'], label: 'Adelanto' }).success,
    ).toBe(true);
    expect(depositWriteSchema.safeParse({ keywords: [] }).success).toBe(true);
  });

  it(`REJECTS (does not truncate) a keyword longer than ${DEPOSIT_KEYWORD_MAX_LENGTH} characters`, () => {
    expect(depositWriteSchema.safeParse({ keywords: ['x'.repeat(80)] }).success).toBe(false);
  });

  it(`REJECTS (does not cap) more than ${DEPOSIT_KEYWORDS_MAX} keywords`, () => {
    const tooMany = Array.from({ length: DEPOSIT_KEYWORDS_MAX + 1 }, (_, i) => `kw${i}`);
    expect(depositWriteSchema.safeParse({ keywords: tooMany }).success).toBe(false);
  });

  it('rejects unknown keys, and refuses a client-supplied updatedAt (the handler stamps it)', () => {
    expect(depositWriteSchema.safeParse({ keywords: ['ok'], surprise: 1 }).success).toBe(false);
    expect(
      depositWriteSchema.safeParse({ keywords: ['ok'], updatedAt: '2026-08-20T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('rejects blank and non-string keywords', () => {
    expect(depositWriteSchema.safeParse({ keywords: ['  '] }).success).toBe(false);
    expect(depositWriteSchema.safeParse({ keywords: [1] }).success).toBe(false);
  });
});
