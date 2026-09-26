import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { FormulaAst } from '$lib/tables/formula';
import { compileFormulaSql } from './formula-sql';

const ref = (sourceId: string): FormulaAst => ({ kind: 'reference', sourceId, from: 0, to: 1 });
const literal = (value: number): FormulaAst => ({
  kind: 'literal',
  value,
  valueType: 'number',
  from: 0,
  to: 1,
});
const render = (fragment: ReturnType<typeof compileFormulaSql>) => {
  const dialect = new PgDialect();
  return {
    value: dialect.sqlToQuery(fragment.valueSql),
    error: dialect.sqlToQuery(fragment.errorSql),
  };
};

describe('formula SQL compiler', () => {
  it('binds leaves and guards division by zero and numeric magnitude', () => {
    const ast: FormulaAst = {
      kind: 'binary',
      operator: '/',
      left: ref('price'),
      right: literal(0),
      from: 0,
      to: 3,
    };
    const query = render(compileFormulaSql(ast, new Map([['price', sql`${123}`]])));
    expect(query.value.sql).toContain('nullif');
    expect(query.value.sql).toContain('abs');
    expect(query.error.sql).toContain('division_by_zero');
    expect(query.value.params).toContain(123);
  });

  it('keeps CASE branch errors lazy', () => {
    const divided: FormulaAst = {
      kind: 'binary',
      operator: '/',
      left: literal(1),
      right: literal(0),
      from: 0,
      to: 3,
    };
    const ast: FormulaAst = {
      kind: 'case',
      branches: [
        {
          when: { kind: 'literal', value: false, valueType: 'boolean', from: 0, to: 1 },
          then: divided,
        },
      ],
      otherwise: literal(7),
      from: 0,
      to: 10,
    };
    const query = render(compileFormulaSql(ast, new Map()));
    expect(query.error.sql).toMatch(/case when .* is true then .*division_by_zero/s);
  });

  it('returns an error for a missing stable dependency without interpolating its id', () => {
    const query = render(compileFormulaSql(ref(`x'); drop table secrets; --`), new Map()));
    expect(query.value.sql).not.toContain('drop table');
    expect(query.error.sql).toContain('invalid_dependency');
  });

  it('rejects adversarial expansion before building a huge SQL fragment', () => {
    let ast = ref('price');
    for (let index = 0; index < 20; index++)
      ast = { kind: 'binary', operator: '+', left: ast, right: literal(1), from: 0, to: index + 2 };
    expect(() => compileFormulaSql(ast, new Map([['price', sql`${1}`]]))).toThrowError(
      expect.objectContaining({ code: 'expression_too_complex' }),
    );
  });
});
