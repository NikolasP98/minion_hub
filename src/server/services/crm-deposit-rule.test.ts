import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  depositMatchSql,
  depositWriteSchema,
  normalizeDepositRule,
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

describe('normalizeDepositRule (the READ boundary — lenient, then clamped)', () => {
  it('trims, lowercases and preserves the operator’s order', () => {
    expect(normalizeDepositRule({ keywords: ['  Adelanto ', 'SEÑA'] })).toEqual({
      keywords: ['adelanto', 'seña'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it('drops empty/whitespace-only entries and dedupes case-insensitively (first wins)', () => {
    expect(normalizeDepositRule({ keywords: ['reserva', '   ', 'RESERVA', '', 'abono'] })).toEqual({
      keywords: ['reserva', 'abono'],
      label: DEFAULT_DEPOSIT_RULE.label,
    });
  });

  it(`truncates a keyword to ${DEPOSIT_KEYWORD_MAX_LENGTH} characters`, () => {
    const rule = normalizeDepositRule({ keywords: ['x'.repeat(80)] });
    expect(rule?.keywords).toEqual(['x'.repeat(DEPOSIT_KEYWORD_MAX_LENGTH)]);
  });

  it(`caps a hand-written 40-keyword row at ${DEPOSIT_KEYWORDS_MAX} — asserted on the BUILT SQL, not the input`, () => {
    const raw = { keywords: Array.from({ length: 40 }, (_, i) => `kw${i}`) };
    const rule = normalizeDepositRule(raw);
    expect(rule).not.toBeNull();
    const { params } = render(depositMatchSql('ii.description', rule as DepositRule));
    expect(params).toHaveLength(DEPOSIT_KEYWORDS_MAX);
    expect(params[0]).toBe('%kw0%');
    expect(params[DEPOSIT_KEYWORDS_MAX - 1]).toBe(`%kw${DEPOSIT_KEYWORDS_MAX - 1}%`);
  });

  it('keeps an EXPLICITLY EMPTY keyword list — "this org has no deposit concept" is a config, not a fallback', () => {
    expect(normalizeDepositRule({ keywords: [], label: 'x' })).toEqual({
      keywords: [],
      label: 'x',
    });
  });

  it('takes the label as display text: trimmed and truncated, never lowercased', () => {
    expect(normalizeDepositRule({ keywords: ['dep'], label: '  Down Payment  ' })?.label).toBe(
      'Down Payment',
    );
    expect(normalizeDepositRule({ keywords: ['dep'], label: 'L'.repeat(80) })?.label).toBe(
      'L'.repeat(DEPOSIT_KEYWORD_MAX_LENGTH),
    );
  });

  it('falls back to the default label when the stored label is absent or blank', () => {
    expect(normalizeDepositRule({ keywords: ['dep'] })?.label).toBe(DEFAULT_DEPOSIT_RULE.label);
    expect(normalizeDepositRule({ keywords: ['dep'], label: '   ' })?.label).toBe(
      DEFAULT_DEPOSIT_RULE.label,
    );
  });

  it('ignores unknown sibling keys — strictness is the WRITE path’s job', () => {
    expect(
      normalizeDepositRule({ keywords: ['dep'], surprise: 1, updatedAt: '2026-08-20' }),
    ).toEqual({ keywords: ['dep'], label: DEFAULT_DEPOSIT_RULE.label });
  });

  it.each([
    ['a bare string', 'reserva'],
    ['non-string members', { keywords: [1, 2] }],
    ['a non-array keywords', { keywords: 'reserva' }],
    ['a missing keywords key', { label: 'x' }],
    ['null', null],
    ['a number', 7],
  ])('returns null for a malformed blob: %s', (_name, raw) => {
    expect(normalizeDepositRule(raw)).toBeNull();
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
