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

const dialect = new PgDialect();
const render = (frag: ReturnType<typeof depositMatchSql>) => dialect.sqlToQuery(frag);

/** Evaluates a SQL LIKE/ILIKE pattern (as produced by escapeLikePattern) against
 *  text, case-insensitively — a minimal reimplementation used only to prove
 *  isDepositText (the TS side) agrees with what the generated SQL pattern
 *  (the DB side) would actually match. */
function likeMatches(text: string, pattern: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      re += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (c === '%') {
      re += '.*';
    } else if (c === '_') {
      re += '.';
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'is').test(text);
}

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

  it("an escaped '100%' pattern does not match an unrelated row", () => {
    const pattern = escapeLikePattern('100%');
    expect(likeMatches('anything', pattern)).toBe(false);
    expect(likeMatches('this costs 100% today', pattern)).toBe(true);
    expect(likeMatches('this costs 100 today', pattern)).toBe(false);
  });
});

describe('depositMatchSql / notDepositMatchSql', () => {
  it('single-keyword rule renders one bound ILIKE clause', () => {
    const { sql, params } = render(depositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('(ii.description ilike $1)');
    expect(params).toEqual(['%reserva%']);
  });

  it('notDepositMatchSql renders the negated, bound clause', () => {
    const { sql, params } = render(notDepositMatchSql('ii.description', DEFAULT_DEPOSIT_RULE));
    expect(sql).toBe('(ii.description not ilike $1)');
    expect(params).toEqual(['%reserva%']);
  });

  it('multi-keyword rule ORs deposit matches and ANDs non-matches', () => {
    const rule: DepositRule = { keywords: ['adelanto', 'seña'], label: 'Adelanto' };
    const pos = render(depositMatchSql('ii.description', rule));
    expect(pos.sql).toBe('(ii.description ilike $1 or ii.description ilike $2)');
    expect(pos.params).toEqual(['%adelanto%', '%seña%']);

    const neg = render(notDepositMatchSql('ii.description', rule));
    expect(neg.sql).toBe('(ii.description not ilike $1 and ii.description not ilike $2)');
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

describe('isDepositText / depositMatchSql agreement (shared table)', () => {
  const rule = DEFAULT_DEPOSIT_RULE;
  const pattern = escapeLikePattern(rule.keywords[0]);

  const cases: Array<[string | null | undefined, boolean]> = [
    ['Reserva de Consulta', true], // display casing
    ['RESERVA', true], // upper case
    ['reserva', true], // exact
    ['una reserva por cita', true], // substring-in-sentence
    ['prereserva', true], // substring-in-word
    ['reservó', false], // accents-as-typed: no accent folding, é != a
    ['adelanto', false], // different word entirely
    ['', false], // empty string
    [null, false], // null
    [undefined, false], // undefined
  ];

  it.each(cases)('isDepositText(%j) → %s, agrees with the ILIKE pattern', (text, expected) => {
    expect(isDepositText(text, rule)).toBe(expected);
    if (text != null) expect(likeMatches(text, pattern)).toBe(expected);
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
