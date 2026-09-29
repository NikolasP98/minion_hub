export const FORMULA_LANGUAGE_VERSION = 1 as const;
export const FORMULA_EXPRESSION_MAX = 2_000;
export const FORMULA_NODE_MAX = 256;
export const FORMULA_DEPTH_MAX = 32;
export const FORMULA_DEPENDENCY_MAX = 64;
export const FORMULA_NUMBER_ABS_MAX = 1_000_000_000_000_000;
export const FORMULA_PRECISION_MAX = 12;
export const FORMULA_VARIABLES_MAX = 12;
export const FORMULA_VARIABLE_NAME_MAX = 40;
export const FORMULA_VARIABLE_AGGREGATE_NODE_MAX = 256;
export const FORMULA_VARIABLE_AGGREGATE_DEPENDENCY_MAX = 64;
export const FORMULA_VARIABLE_AGGREGATE_SQL_EXPANSION_MAX = 50_000;
export const FORMULA_VARIABLE_EVALUATIONS_PER_STATEMENT_MAX = 500;

export type FormulaNumberType = {
  kind: 'number';
  dimension: 'unitless' | 'percent' | 'money';
  currency: string | null;
  basis: string | null;
};
export type FormulaScalarType =
  FormulaNumberType | { kind: 'text' } | { kind: 'boolean' } | { kind: 'date' };
export type FormulaNullableType = FormulaScalarType & { nullable: boolean };

export type FormulaSourceDescriptor = {
  id: string;
  label: string;
  aliases: string[];
  type: FormulaScalarType;
  nullable: boolean;
  source: 'native' | 'custom' | 'formula';
};
export type FormulaDependency = Pick<FormulaSourceDescriptor, 'id' | 'source'>;
export type FormulaSpan = { from: number; to: number };

export type FormulaAst =
  | ({
      kind: 'literal';
      value: string | number | boolean | null;
      valueType: 'text' | 'number' | 'boolean' | 'null';
    } & FormulaSpan)
  | ({ kind: 'reference'; sourceId: string } & FormulaSpan)
  | ({ kind: 'unary'; operator: '+' | '-' | 'NOT'; operand: FormulaAst } & FormulaSpan)
  | ({
      kind: 'binary';
      operator: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR';
      left: FormulaAst;
      right: FormulaAst;
    } & FormulaSpan)
  | ({ kind: 'is_null'; operand: FormulaAst; negated: boolean } & FormulaSpan)
  | ({
      kind: 'call';
      name: 'ROUND' | 'ABS' | 'COALESCE' | 'NULLIF' | 'LEAST' | 'GREATEST';
      arguments: FormulaAst[];
    } & FormulaSpan)
  | ({
      kind: 'case';
      branches: Array<{ when: FormulaAst; then: FormulaAst }>;
      otherwise: FormulaAst;
    } & FormulaSpan);

export type FormulaDiagnosticCode =
  | 'expression_too_long'
  | 'syntax_error'
  | 'unknown_reference'
  | 'ambiguous_reference'
  | 'unknown_function'
  | 'invalid_argument_count'
  | 'type_mismatch'
  | 'invalid_precision'
  | 'node_limit'
  | 'depth_limit'
  | 'dependency_limit'
  | 'numeric_out_of_range'
  | 'expression_too_complex'
  | 'formula_cycle';
export type FormulaDiagnostic = FormulaSpan & {
  code: FormulaDiagnosticCode;
  messageKey: string;
  severity: 'error' | 'warning';
  args?: Record<string, string | number>;
};

export type FormulaDraftRulesV1 = { type: 'formula'; expression: string };
export type FormulaRulesV1 = FormulaDraftRulesV1 & {
  languageVersion: typeof FORMULA_LANGUAGE_VERSION;
  ast: FormulaAst;
  outputType: FormulaNullableType;
  dependencies: FormulaDependency[];
};
export type FormulaVariableDraft = {
  id: string;
  name: string | null;
  expression: string;
};
export type FormulaVariableRules = FormulaVariableDraft & {
  languageVersion: typeof FORMULA_LANGUAGE_VERSION;
  ast: FormulaAst;
  outputType: FormulaNullableType;
  dependencies: FormulaDependency[];
};
export type FormulaDraftRulesV2 = {
  type: 'formula';
  version: 2;
  primaryVariableId: string;
  variables: FormulaVariableDraft[];
};
export type FormulaRulesV2 = {
  type: 'formula';
  version: 2;
  primaryVariableId: string;
  variables: FormulaVariableRules[];
};
export type FormulaDraftRules = FormulaDraftRulesV1 | FormulaDraftRulesV2;
export type FormulaRules = FormulaRulesV1 | FormulaRulesV2;

export function formulaVariables(
  rules: FormulaRules,
  legacyVariableId?: string,
): readonly FormulaVariableRules[] {
  if ('version' in rules) return rules.variables;
  if (!legacyVariableId) throw new Error('legacy_formula_variable_id_required');
  return [
    {
      id: legacyVariableId,
      name: null,
      expression: rules.expression,
      languageVersion: rules.languageVersion,
      ast: rules.ast,
      outputType: rules.outputType,
      dependencies: rules.dependencies,
    },
  ];
}

export function primaryFormulaVariable(
  rules: FormulaRules,
  legacyVariableId?: string,
): FormulaVariableRules {
  if (!('version' in rules)) return formulaVariables(rules, legacyVariableId)[0];
  const variable = rules.variables.find(({ id }) => id === rules.primaryVariableId);
  if (!variable) throw new Error('formula_primary_variable_missing');
  return variable;
}

export function formulaPrimaryDependencies(rules: FormulaRules): readonly FormulaDependency[] {
  return 'version' in rules ? primaryFormulaVariable(rules).dependencies : rules.dependencies;
}

export function formulaDependencies(rules: FormulaRules): FormulaDependency[] {
  const byId = new Map<string, FormulaDependency>();
  if (!('version' in rules)) return [...rules.dependencies];
  for (const variable of rules.variables)
    for (const dependency of variable.dependencies) byId.set(dependency.id, dependency);
  return [...byId.values()];
}

export function primaryFormulaOutputType(rules: FormulaRules): FormulaNullableType {
  return 'version' in rules ? primaryFormulaVariable(rules).outputType : rules.outputType;
}

export function primaryFormulaAst(rules: FormulaRules): FormulaAst {
  return 'version' in rules ? primaryFormulaVariable(rules).ast : rules.ast;
}
export type FormulaAnalysis = {
  ast: FormulaAst | null;
  outputType: FormulaNullableType | null;
  dependencies: FormulaDependency[];
  diagnostics: FormulaDiagnostic[];
};

export type FormulaQuality = 'valid' | 'blank' | 'partial' | 'restricted' | 'error';
export type FormulaCellMetadata = {
  quality: FormulaQuality;
  code: string | null;
  currency: string | null;
  sourceUpdatedAt: string | null;
};
export type FormulaNativeComparison = {
  value: number | null;
  delta: number | null;
  status: 'match' | 'different' | 'unavailable';
};
export type FormulaPreviewRequestV1 = {
  tableId: string;
  expression: string;
  recordIds: string[];
  propertyId?: string;
  catalogRevision?: string;
};
export type FormulaPreviewRequestV2 = {
  tableId: string;
  rules: FormulaDraftRulesV2;
  presentation?: import('../column-presentation').ColumnPresentationV2 | null;
  recordIds: string[];
  propertyId?: string;
  catalogRevision: string;
};
export type FormulaPreviewRequest = FormulaPreviewRequestV1 | FormulaPreviewRequestV2;
export type FormulaFunctionName = 'ROUND' | 'ABS' | 'COALESCE' | 'NULLIF' | 'LEAST' | 'GREATEST';
export type FormulaCatalogResponse = {
  fields: FormulaSourceDescriptor[];
  functions: FormulaFunctionName[];
  canManage: boolean;
  revision: string;
};
export type FormulaPreviewRow = {
  recordId: string;
  inputs: Record<string, string | number | boolean | null>;
  result: { value: string | number | boolean | null; formula: FormulaCellMetadata };
  nativeComparison?: FormulaNativeComparison;
  variables?: Array<{
    variableId: string;
    value: string | number | boolean | null;
    formula: FormulaCellMetadata;
  }>;
};
export type FormulaVariableAnalysis = {
  variableId: string;
  outputType: FormulaNullableType | null;
  dependencies: FormulaDependency[];
  diagnostics: Array<FormulaDiagnostic & { variableId: string }>;
};
export type FormulaPreviewResponse = {
  diagnostics: FormulaDiagnostic[];
  outputType: FormulaNullableType | null;
  dependencies: FormulaDependency[];
  rows: FormulaPreviewRow[];
  variables?: FormulaVariableAnalysis[];
};
