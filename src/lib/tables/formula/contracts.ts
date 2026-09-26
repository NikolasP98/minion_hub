export const FORMULA_LANGUAGE_VERSION = 1 as const;
export const FORMULA_EXPRESSION_MAX = 2_000;
export const FORMULA_NODE_MAX = 256;
export const FORMULA_DEPTH_MAX = 32;
export const FORMULA_DEPENDENCY_MAX = 64;
export const FORMULA_NUMBER_ABS_MAX = 1_000_000_000_000_000;
export const FORMULA_PRECISION_MAX = 12;

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
  | 'expression_too_complex';
export type FormulaDiagnostic = FormulaSpan & {
  code: FormulaDiagnosticCode;
  messageKey: string;
  severity: 'error' | 'warning';
  args?: Record<string, string | number>;
};

export type FormulaDraftRules = { type: 'formula'; expression: string };
export type FormulaRules = FormulaDraftRules & {
  languageVersion: typeof FORMULA_LANGUAGE_VERSION;
  ast: FormulaAst;
  outputType: FormulaNullableType;
  dependencies: FormulaDependency[];
};
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
export type FormulaPreviewRequest = {
  tableId: string;
  expression: string;
  recordIds: string[];
  propertyId?: string;
};
export type FormulaPreviewRow = {
  recordId: string;
  inputs: Record<string, string | number | boolean | null>;
  result: { value: string | number | boolean | null; formula: FormulaCellMetadata };
  nativeComparison?: FormulaNativeComparison;
};
export type FormulaPreviewResponse = {
  diagnostics: FormulaDiagnostic[];
  outputType: FormulaNullableType | null;
  dependencies: FormulaDependency[];
  rows: FormulaPreviewRow[];
};
