import {
  FORMULA_DEPENDENCY_MAX,
  FORMULA_NUMBER_ABS_MAX,
  FORMULA_PRECISION_MAX,
  type FormulaAnalysis,
  type FormulaAst,
  type FormulaDiagnostic,
  type FormulaNullableType,
  type FormulaScalarType,
  type FormulaSourceDescriptor,
} from './contracts';
import { parseFormula } from './parser';

const unitless: FormulaScalarType = {
  kind: 'number',
  dimension: 'unitless',
  currency: null,
  basis: null,
};
const boolean: FormulaScalarType = { kind: 'boolean' };
const issue = (
  code: FormulaDiagnostic['code'],
  n: FormulaAst,
  args?: Record<string, string | number>,
): FormulaDiagnostic => ({
  code,
  messageKey: `formula_${code}`,
  from: n.from,
  to: n.to,
  severity: 'error',
  args,
});
type Inferred = FormulaNullableType & { nullOnly?: boolean };
const same = (a: FormulaScalarType, b: FormulaScalarType) => sameType(a as Inferred, b as Inferred);
const numeric = (t: FormulaScalarType): t is Extract<FormulaScalarType, { kind: 'number' }> =>
  t.kind === 'number';

export function analyzeFormula(
  expression: string,
  sources: readonly FormulaSourceDescriptor[],
): FormulaAnalysis {
  const parsed = parseFormula(expression, sources);
  if (!parsed.ast) return { ...parsed, outputType: null, dependencies: [] };
  return typecheckFormulaAst(parsed.ast, sources);
}

/** Revalidate a persisted stable-id AST without reparsing rename-sensitive labels. */
export function typecheckFormulaAst(
  ast: FormulaAst,
  sources: readonly FormulaSourceDescriptor[],
): FormulaAnalysis {
  const diagnostics: FormulaDiagnostic[] = [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const deps = new Map<string, FormulaSourceDescriptor>();
  const infer = (n: FormulaAst): Inferred => {
    const bad = (
      code: FormulaDiagnostic['code'],
      fallback: FormulaScalarType = unitless,
      args?: Record<string, string | number>,
    ) => {
      diagnostics.push(issue(code, n, args));
      return { ...fallback, nullable: true };
    };
    if (n.kind === 'literal') {
      if (n.valueType === 'null') return { ...unitless, nullable: true, nullOnly: true };
      if (n.valueType === 'number') {
        if (Math.abs(n.value as number) > FORMULA_NUMBER_ABS_MAX)
          diagnostics.push(issue('numeric_out_of_range', n));
        return { ...unitless, nullable: false };
      }
      return { kind: n.valueType as 'text' | 'boolean', nullable: false };
    }
    if (n.kind === 'reference') {
      const s = byId.get(n.sourceId);
      if (!s) return bad('unknown_reference');
      deps.set(s.id, s);
      return { ...s.type, nullable: s.nullable };
    }
    if (n.kind === 'unary') {
      const v = infer(n.operand);
      if (n.operator === 'NOT')
        return v.kind === 'boolean'
          ? { ...boolean, nullable: v.nullable }
          : bad('type_mismatch', boolean);
      return numeric(v) ? { ...v } : bad('type_mismatch');
    }
    if (n.kind === 'is_null') {
      infer(n.operand);
      return { ...boolean, nullable: false };
    }
    if (n.kind === 'binary') {
      const l = infer(n.left),
        r = infer(n.right);
      if (n.operator === 'AND' || n.operator === 'OR')
        return l.kind === 'boolean' && r.kind === 'boolean'
          ? { ...boolean, nullable: l.nullable || r.nullable }
          : bad('type_mismatch', boolean);
      if (['=', '<>', '<', '<=', '>', '>='].includes(n.operator))
        return compatible(l, r)
          ? { ...boolean, nullable: l.nullable || r.nullable }
          : bad('type_mismatch', boolean);
      if (l.nullOnly) return { ...r, nullable: true };
      if (r.nullOnly) return { ...l, nullable: true };
      if (!numeric(l) || !numeric(r)) return bad('type_mismatch');
      if (n.operator === '+' || n.operator === '-')
        return same(l, r) ? { ...l, nullable: l.nullable || r.nullable } : bad('type_mismatch');
      if (n.operator === '*') {
        if (l.dimension === 'unitless') return { ...r, nullable: l.nullable || r.nullable };
        if (r.dimension === 'unitless') return { ...l, nullable: l.nullable || r.nullable };
        return bad('type_mismatch');
      }
      if (r.dimension === 'unitless') return { ...l, nullable: l.nullable || r.nullable };
      if (same(l, r)) return { ...unitless, nullable: l.nullable || r.nullable };
      return bad('type_mismatch');
    }
    if (n.kind === 'case') {
      const branchTypes = n.branches.map((b) => {
        const c = infer(b.when);
        if (c.kind !== 'boolean') diagnostics.push(issue('type_mismatch', b.when));
        return infer(b.then);
      });
      const other = infer(n.otherwise);
      const all = [...branchTypes, other];
      const first = all.find((t) => !t.nullOnly) ?? all[0];
      if (!all.every((t) => compatible(first, t))) return bad('type_mismatch');
      return {
        ...first,
        nullOnly: all.every((t) => t.nullOnly),
        nullable: all.some((t) => t.nullable),
      };
    }
    const args = n.arguments.map(infer);
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max) {
        diagnostics.push(issue('invalid_argument_count', n, { min, max }));
        return false;
      }
      return true;
    };
    if (n.name === 'ABS') {
      if (!arity(1) || !numeric(args[0])) return bad('type_mismatch');
      return { ...args[0] };
    }
    if (n.name === 'ROUND') {
      if (!arity(1, 2) || !numeric(args[0]) || (args[1] && !numeric(args[1])))
        return bad('type_mismatch');
      if (
        n.arguments[1] &&
        (n.arguments[1].kind !== 'literal' ||
          typeof n.arguments[1].value !== 'number' ||
          !Number.isInteger(n.arguments[1].value) ||
          Math.abs(n.arguments[1].value) > FORMULA_PRECISION_MAX)
      )
        diagnostics.push(issue('invalid_precision', n.arguments[1]));
      return { ...args[0] };
    }
    if (n.name === 'NULLIF') {
      if (!arity(2) || !sameType(args[0], args[1])) return bad('type_mismatch');
      return { ...args[0], nullable: true };
    }
    if (!arity(n.name === 'COALESCE' ? 1 : 2, 64)) return bad('invalid_argument_count');
    const first = args.find((a) => !a.nullOnly) ??
      args[0] ?? { ...unitless, nullable: true, nullOnly: true };
    if (!args.every((a) => compatible(first, a))) return bad('type_mismatch');
    return {
      ...first,
      nullable:
        n.name === 'COALESCE' ? args.every((a) => a.nullable) : args.every((a) => a.nullable),
    };
  };
  const inferred = infer(ast);
  const { nullOnly: _nullOnly, ...outputType } = inferred;
  const dependencies = [...deps.values()].map(({ id, source }) => ({ id, source }));
  if (dependencies.length > FORMULA_DEPENDENCY_MAX)
    diagnostics.push(issue('dependency_limit', ast));
  return {
    ast,
    outputType: diagnostics.length ? null : outputType,
    dependencies,
    diagnostics,
  };
}
function sameType(a: FormulaNullableType, b: FormulaNullableType): boolean {
  if (a.kind !== b.kind) return false;
  return (
    a.kind !== 'number' ||
    (b.kind === 'number' &&
      a.dimension === b.dimension &&
      a.currency === b.currency &&
      a.basis === b.basis)
  );
}
function compatible(a: Inferred, b: Inferred): boolean {
  return !!a.nullOnly || !!b.nullOnly || sameType(a, b);
}
