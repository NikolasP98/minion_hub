import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DEFAULT_DEPOSIT_RULE,
  depositMatchSql,
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
    expect(DEFAULT_DEPOSIT_RULE).toEqual({ keywords: ['reserva'], label: 'Reserved a consult' });
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
