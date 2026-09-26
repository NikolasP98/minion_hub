import { sql, type SQL } from 'drizzle-orm';
import {
  estimateFormulaSqlExpansion,
  FORMULA_NUMBER_ABS_MAX,
  type FormulaAst,
} from '$lib/tables/formula';

export type CompiledFormulaSql = { valueSql: SQL; errorSql: SQL };
export class FormulaSqlCompileError extends Error {
  readonly code = 'expression_too_complex';
}
const SQL_EXPANSION_BUDGET = 50_000;
const none = sql<string | null>`null::text`;
const firstError = (parts: CompiledFormulaSql[]) =>
  parts.reduceRight((tail, p) => sql`coalesce(${p.errorSql},${tail})`, none as SQL);
const bounded = (raw: SQL) => ({
  valueSql: sql`case when abs(${raw}) <= ${FORMULA_NUMBER_ABS_MAX}::numeric then ${raw} else null end`,
  errorSql: sql`case when ${raw} is not null and abs(${raw}) > ${FORMULA_NUMBER_ABS_MAX}::numeric then 'numeric_out_of_range' else null end`,
});

/** Compile only a checked canonical AST. Authored text never reaches SQL. */
export function compileFormulaSql(
  ast: FormulaAst,
  inputs: ReadonlyMap<string, SQL>,
): CompiledFormulaSql {
  if (estimateFormulaSqlExpansion(ast) > SQL_EXPANSION_BUDGET) throw new FormulaSqlCompileError();
  const compile = (n: FormulaAst): CompiledFormulaSql => {
    if (n.kind === 'literal')
      return {
        valueSql:
          n.valueType === 'number'
            ? sql`${n.value}::numeric`
            : n.valueType === 'boolean'
              ? sql`${n.value}::boolean`
              : n.valueType === 'text'
                ? sql`${n.value}::text`
                : sql`null`,
        errorSql: none,
      };
    if (n.kind === 'reference') {
      const value = inputs.get(n.sourceId);
      if (!value) return { valueSql: sql`null`, errorSql: sql`'invalid_dependency'::text` };
      return { valueSql: value, errorSql: none };
    }
    if (n.kind === 'is_null') {
      const a = compile(n.operand);
      return {
        valueSql: n.negated ? sql`(${a.valueSql}) is not null` : sql`(${a.valueSql}) is null`,
        errorSql: a.errorSql,
      };
    }
    if (n.kind === 'unary') {
      const a = compile(n.operand);
      if (n.operator === 'NOT') return { valueSql: sql`not (${a.valueSql})`, errorSql: a.errorSql };
      if (n.operator === '+') return a;
      const result = bounded(sql`-(${a.valueSql})`);
      return {
        valueSql: result.valueSql,
        errorSql: sql`coalesce(${a.errorSql},${result.errorSql})`,
      };
    }
    if (n.kind === 'binary') {
      const l = compile(n.left),
        r = compile(n.right),
        children = firstError([l, r]);
      if (n.operator === 'AND' || n.operator === 'OR')
        return {
          valueSql:
            n.operator === 'AND'
              ? sql`(${l.valueSql}) and (${r.valueSql})`
              : sql`(${l.valueSql}) or (${r.valueSql})`,
          errorSql: children,
        };
      if (['=', '<>', '<', '<=', '>', '>='].includes(n.operator)) {
        const value =
          n.operator === '='
            ? sql`(${l.valueSql}) = (${r.valueSql})`
            : n.operator === '<>'
              ? sql`(${l.valueSql}) <> (${r.valueSql})`
              : n.operator === '<'
                ? sql`(${l.valueSql}) < (${r.valueSql})`
                : n.operator === '<='
                  ? sql`(${l.valueSql}) <= (${r.valueSql})`
                  : n.operator === '>'
                    ? sql`(${l.valueSql}) > (${r.valueSql})`
                    : sql`(${l.valueSql}) >= (${r.valueSql})`;
        return { valueSql: value, errorSql: children };
      }
      if (n.operator === '/') {
        const raw = sql`(${l.valueSql}) / nullif((${r.valueSql}),0::numeric)`,
          result = bounded(raw);
        return {
          valueSql: result.valueSql,
          errorSql: sql`coalesce(${children},case when (${l.valueSql}) is not null and (${r.valueSql}) = 0::numeric then 'division_by_zero' else null end,${result.errorSql})`,
        };
      }
      const raw =
        n.operator === '+'
          ? sql`(${l.valueSql}) + (${r.valueSql})`
          : n.operator === '-'
            ? sql`(${l.valueSql}) - (${r.valueSql})`
            : sql`(${l.valueSql}) * (${r.valueSql})`;
      const result = bounded(raw);
      return { valueSql: result.valueSql, errorSql: sql`coalesce(${children},${result.errorSql})` };
    }
    if (n.kind === 'case') {
      const conditions = n.branches.map((b) => compile(b.when));
      const results = n.branches.map((b) => compile(b.then));
      const other = compile(n.otherwise);
      let value = other.valueSql,
        error = other.errorSql;
      for (let i = n.branches.length - 1; i >= 0; i--) {
        value = sql`case when (${conditions[i].valueSql}) is true then ${results[i].valueSql} else ${value} end`;
        error = sql`case when ${conditions[i].errorSql} is not null then ${conditions[i].errorSql} when (${conditions[i].valueSql}) is true then ${results[i].errorSql} else ${error} end`;
      }
      return { valueSql: value, errorSql: error };
    }
    const args = n.arguments.map(compile),
      errors = firstError(args);
    if (n.name === 'ABS') {
      const result = bounded(sql`abs(${args[0].valueSql})`);
      return { valueSql: result.valueSql, errorSql: sql`coalesce(${errors},${result.errorSql})` };
    }
    if (n.name === 'ROUND') {
      const result = bounded(
        n.arguments.length === 1
          ? sql`round(${args[0].valueSql})`
          : sql`round(${args[0].valueSql},(${args[1].valueSql})::integer)`,
      );
      return { valueSql: result.valueSql, errorSql: sql`coalesce(${errors},${result.errorSql})` };
    }
    if (n.name === 'NULLIF')
      return { valueSql: sql`nullif(${args[0].valueSql},${args[1].valueSql})`, errorSql: errors };
    if (n.name === 'COALESCE') {
      let value = sql`null`,
        error = none as SQL;
      for (let i = args.length - 1; i >= 0; i--) {
        value = sql`case when ${args[i].valueSql} is not null then ${args[i].valueSql} else ${value} end`;
        error = sql`case when ${args[i].errorSql} is not null then ${args[i].errorSql} when ${args[i].valueSql} is not null then null else ${error} end`;
      }
      return { valueSql: value, errorSql: error };
    }
    const fn = n.name === 'LEAST' ? sql.raw('least') : sql.raw('greatest');
    return {
      valueSql: sql`${fn}(${sql.join(
        args.map((a) => a.valueSql),
        sql`,`,
      )})`,
      errorSql: errors,
    };
  };
  return compile(ast);
}
