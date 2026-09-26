import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { analyzeFormula, type FormulaAst, type FormulaSourceDescriptor } from '$lib/tables/formula';
import { compileFormulaSql } from './formula-sql';

const databaseUrl = testDatabaseUrl();
const client = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const db = client ? drizzle(client) : null;
const unitless = { kind: 'number', dimension: 'unitless', currency: null, basis: null } as const;
const fields: FormulaSourceDescriptor[] = [
  { id: 'n', label: 'Number', aliases: [], type: unitless, nullable: true, source: 'custom' },
  {
    id: 'b',
    label: 'Boolean',
    aliases: [],
    type: { kind: 'boolean' },
    nullable: true,
    source: 'custom',
  },
  { id: 'd', label: 'Date', aliases: [], type: { kind: 'date' }, nullable: true, source: 'custom' },
  { id: 't', label: 'Text', aliases: [], type: { kind: 'text' }, nullable: true, source: 'custom' },
  {
    id: 'errored',
    label: 'Errored',
    aliases: [],
    type: unitless,
    nullable: true,
    source: 'formula',
  },
];

async function evaluate(
  expression: string,
  values: ReadonlyMap<string, SQL> = new Map(),
  errors: ReadonlyMap<string, SQL> = new Map(),
) {
  const analysis = analyzeFormula(expression, fields);
  expect(analysis.diagnostics).toEqual([]);
  const compiled = compileFormulaSql(analysis.ast!, values, errors);
  const rows = (await db!.execute(
    sql`select ${compiled.valueSql} as value, ${compiled.errorSql} as error`,
  )) as unknown as Array<{ value: unknown; error: string | null }>;
  return rows[0];
}

describe.runIf(Boolean(databaseUrl))('formula compiler PostgreSQL semantics', () => {
  afterAll(async () => client?.end());

  it('evaluates every scalar type with PostgreSQL numeric semantics', async () => {
    expect(await evaluate('ROUND(-1.005, 2)')).toEqual({ value: '-1.01', error: null });
    expect(await evaluate('TRUE')).toEqual({ value: true, error: null });
    expect(await evaluate(`COALESCE(NULL, 'safe')`)).toEqual({ value: 'safe', error: null });
    expect(await evaluate('"Date"', new Map([['d', sql`${`2026-09-26`}::date`]]))).toEqual({
      value: '2026-09-26',
      error: null,
    });
  });

  it('preserves lazy errors for CASE and COALESCE, including formula references', async () => {
    const values = new Map<string, SQL>([['errored', sql`null::numeric`]]);
    const errors = new Map<string, SQL>([['errored', sql`'division_by_zero'::text`]]);
    expect(await evaluate('CASE WHEN FALSE THEN "Errored" ELSE 7 END', values, errors)).toEqual({
      value: '7',
      error: null,
    });
    expect(await evaluate('COALESCE(4, "Errored")', values, errors)).toEqual({
      value: '4',
      error: null,
    });
    expect(await evaluate('CASE WHEN TRUE THEN "Errored" ELSE 7 END', values, errors)).toEqual({
      value: null,
      error: 'division_by_zero',
    });
  });

  it('treats NULL divided by zero as blank and live division by zero as an error', async () => {
    expect(await evaluate('NULL / 0')).toEqual({ value: null, error: null });
    expect(await evaluate('1 / 0')).toEqual({ value: null, error: 'division_by_zero' });
  });

  it('executes nested boolean comparisons and binds hostile text as data', async () => {
    expect(await evaluate('(1 = 1) = TRUE')).toEqual({ value: true, error: null });
    const hostile = `x'); drop table app_table_properties; --`;
    expect(await evaluate(`'x'`, new Map())).toEqual({ value: 'x', error: null });
    const ast: FormulaAst = {
      kind: 'literal',
      value: hostile,
      valueType: 'text',
      from: 0,
      to: hostile.length,
    };
    const compiled = compileFormulaSql(ast, new Map());
    const rendered = new PgDialect().sqlToQuery(compiled.valueSql);
    expect(rendered.sql).not.toContain('drop table');
    expect(rendered.params).toContain(hostile);
  });

  it('rejects adversarial expansion before sending SQL', () => {
    let ast: FormulaAst = { kind: 'reference', sourceId: 'n', from: 0, to: 1 };
    for (let index = 0; index < 20; index++)
      ast = {
        kind: 'binary',
        operator: '+',
        left: ast,
        right: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 },
        from: 0,
        to: index + 2,
      };
    expect(() => compileFormulaSql(ast, new Map([['n', sql`1::numeric`]]))).toThrowError(
      expect.objectContaining({ code: 'expression_too_complex' }),
    );
  });
});
