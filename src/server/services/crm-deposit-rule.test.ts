import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_DEPOSIT_RULE,
  DEFAULT_RESERVE_LABEL,
  depositMatchSql,
  notDepositMatchSql,
  escapeLikePattern,
  isDepositText,
  normalizeDepositRule,
  MAX_DEPOSIT_KEYWORDS,
  MAX_DEPOSIT_KEYWORD_LENGTH,
  MAX_DEPOSIT_LABEL_LENGTH,
  type DepositRule,
} from './crm-deposit-rule';
import { DEPOSIT_TEXT_CASES } from './crm-deposit-rule.fixtures';

const dialect = new PgDialect();
const render = (frag: ReturnType<typeof depositMatchSql>) => dialect.sqlToQuery(frag);

describe('DEFAULT_DEPOSIT_RULE', () => {
  it('is the FACES-era default — the only occurrence of "reserva" outside this module/tests', () => {
    expect(DEFAULT_DEPOSIT_RULE).toEqual({ keywords: ['reserva'], label: 'Reserva' });
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

  it('empty keywords ⇒ depositMatchSql is a wrapped `false` and notDepositMatchSql a wrapped `true` — never undefined, and never a bare literal (invalid in ORDER BY)', () => {
    const rule: DepositRule = { keywords: [], label: 'x' };
    const pos = depositMatchSql('ii.description', rule);
    const neg = notDepositMatchSql('ii.description', rule);
    expect(pos).toBeDefined();
    expect(neg).toBeDefined();
    expect(render(pos)).toMatchObject({ sql: 'coalesce(false, false)', params: [] });
    expect(render(neg)).toMatchObject({ sql: 'coalesce(true, true)', params: [] });
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

describe('normalizeDepositRule', () => {
  it('absent value (undefined) resolves to the default keywords with the corrected reserve label, ok=true', () => {
    expect(normalizeDepositRule(undefined)).toEqual({
      rule: { keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL },
      ok: true,
    });
    expect(DEFAULT_RESERVE_LABEL).toBe('Reserved a consult');
    // The corrected default label supersedes DEFAULT_DEPOSIT_RULE.label ('Reserva')
    // for the resolved/normalized rule — DEFAULT_DEPOSIT_RULE itself is unchanged.
    expect(normalizeDepositRule(undefined).rule.label).not.toBe(DEFAULT_DEPOSIT_RULE.label);
  });

  it.each([null, 'reserva', 42, ['reserva'], { keywords: 'reserva' }, { keywords: [1, 2] }])(
    'malformed value %j resolves to the default rule, ok=false',
    (raw) => {
      expect(normalizeDepositRule(raw)).toEqual({
        rule: { keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL },
        ok: false,
      });
    },
  );

  it('explicitly empty keywords is valid (ok=true), not malformed — the canonical empty-keyword contract', () => {
    expect(normalizeDepositRule({ keywords: [] })).toEqual({
      rule: { keywords: [], label: DEFAULT_RESERVE_LABEL },
      ok: true,
    });
  });

  it('a valid custom rule with an explicit label is used as-is', () => {
    expect(normalizeDepositRule({ keywords: ['adelanto', 'seña'], label: 'Deposit paid' })).toEqual(
      {
        rule: { keywords: ['adelanto', 'seña'], label: 'Deposit paid' },
        ok: true,
      },
    );
  });

  it('a valid custom rule that omits label falls back to the corrected default label, not "Reserva"', () => {
    const { rule, ok } = normalizeDepositRule({ keywords: ['adelanto'] });
    expect(ok).toBe(true);
    expect(rule).toEqual({ keywords: ['adelanto'], label: DEFAULT_RESERVE_LABEL });
  });

  it('trims keyword/label whitespace and drops empty keyword entries', () => {
    expect(
      normalizeDepositRule({ keywords: [' adelanto ', '', 'seña'], label: '  Deposit paid  ' }),
    ).toEqual({
      rule: { keywords: ['adelanto', 'seña'], label: 'Deposit paid' },
      ok: true,
    });
  });

  it('a blank label falls back to the corrected default label', () => {
    expect(normalizeDepositRule({ keywords: ['adelanto'], label: '   ' })).toEqual({
      rule: { keywords: ['adelanto'], label: DEFAULT_RESERVE_LABEL },
      ok: true,
    });
  });

  it('a present non-string label is malformed, ok=false — never silently defaulted', () => {
    expect(normalizeDepositRule({ keywords: ['reserva'], label: 42 })).toEqual({
      rule: { keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL },
      ok: false,
    });
  });

  it('a label over MAX_DEPOSIT_LABEL_LENGTH is malformed, ok=false', () => {
    const label = 'x'.repeat(MAX_DEPOSIT_LABEL_LENGTH + 1);
    expect(normalizeDepositRule({ keywords: ['reserva'], label })).toEqual({
      rule: { keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL },
      ok: false,
    });
  });

  it('a label exactly at MAX_DEPOSIT_LABEL_LENGTH is valid', () => {
    const label = 'x'.repeat(MAX_DEPOSIT_LABEL_LENGTH);
    expect(normalizeDepositRule({ keywords: ['reserva'], label })).toEqual({
      rule: { keywords: ['reserva'], label },
      ok: true,
    });
  });

  it('a keyword array over MAX_DEPOSIT_KEYWORDS is malformed, ok=false — never reaches SQL construction', () => {
    const keywords = Array.from({ length: MAX_DEPOSIT_KEYWORDS + 1 }, (_, i) => `kw${i}`);
    const { rule, ok } = normalizeDepositRule({ keywords });
    expect(ok).toBe(false);
    expect(rule).toEqual({ keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL });
  });

  it('a keyword array at exactly MAX_DEPOSIT_KEYWORDS is valid', () => {
    const keywords = Array.from({ length: MAX_DEPOSIT_KEYWORDS }, (_, i) => `kw${i}`);
    const { rule, ok } = normalizeDepositRule({ keywords });
    expect(ok).toBe(true);
    expect(rule.keywords).toHaveLength(MAX_DEPOSIT_KEYWORDS);
  });

  it('a single keyword over MAX_DEPOSIT_KEYWORD_LENGTH is malformed, ok=false', () => {
    const oversized = 'x'.repeat(MAX_DEPOSIT_KEYWORD_LENGTH + 1);
    const { rule, ok } = normalizeDepositRule({ keywords: ['reserva', oversized] });
    expect(ok).toBe(false);
    expect(rule).toEqual({ keywords: ['reserva'], label: DEFAULT_RESERVE_LABEL });
  });

  it('a keyword exactly at MAX_DEPOSIT_KEYWORD_LENGTH is valid', () => {
    const atCap = 'x'.repeat(MAX_DEPOSIT_KEYWORD_LENGTH);
    const { rule, ok } = normalizeDepositRule({ keywords: [atCap] });
    expect(ok).toBe(true);
    expect(rule.keywords).toEqual([atCap]);
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
