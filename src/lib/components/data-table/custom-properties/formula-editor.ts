import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Diagnostic } from '@codemirror/lint';
import {
  analyzeFormula,
  type FormulaAnalysis,
  type FormulaDiagnostic,
  type FormulaSourceDescriptor,
} from '$lib/tables/formula';

export const FORMULA_FUNCTIONS = [
  { label: 'ROUND', signature: 'ROUND(value, precision)' },
  { label: 'ABS', signature: 'ABS(value)' },
  { label: 'COALESCE', signature: 'COALESCE(value, fallback, …)' },
  { label: 'NULLIF', signature: 'NULLIF(value, comparison)' },
  { label: 'LEAST', signature: 'LEAST(value, …)' },
  { label: 'GREATEST', signature: 'GREATEST(value, …)' },
] as const;

const escapeReference = (label: string) => `"${label.replaceAll('"', '""')}"`;

function sourceDetail(source: FormulaSourceDescriptor): string {
  const type = source.type;
  const valueType =
    type.kind === 'number'
      ? type.dimension === 'money'
        ? [type.dimension, type.currency].filter(Boolean).join(' ')
        : [type.dimension, type.basis].filter(Boolean).join(' ')
      : type.kind;
  return [valueType, source.nullable ? 'nullable' : null, source.source]
    .filter(Boolean)
    .join(' · ');
}

export function analyzeFormulaDraft(
  expression: string,
  sources: readonly FormulaSourceDescriptor[],
): FormulaAnalysis {
  return analyzeFormula(expression, sources);
}

export function completionOptions(sources: readonly FormulaSourceDescriptor[]): Completion[] {
  const references = sources.flatMap((source) =>
    [source.label, ...source.aliases].map((label) => ({
      label,
      apply: escapeReference(label),
      type: source.source === 'native' ? 'property' : 'variable',
      detail: sourceDetail(source),
      info: sourceDetail(source),
    })),
  );
  const functions: Completion[] = FORMULA_FUNCTIONS.map((fn) => ({
    label: fn.label,
    apply: `${fn.label}()`,
    type: 'function',
    detail: fn.signature,
    info: fn.signature,
  }));
  const keywords: Completion[] = [
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'AND',
    'OR',
    'NOT',
    'IS NULL',
  ].map((label) => ({ label, type: 'keyword' }));
  return [...references, ...functions, ...keywords];
}

export function quotedReferenceCompletionOptions(
  sources: readonly FormulaSourceDescriptor[],
): Completion[] {
  return completionOptions(sources)
    .filter((option) => option.type === 'property' || option.type === 'variable')
    .map((option) => ({
      ...option,
      label: String(option.apply),
      displayLabel: option.label,
    }));
}

export function formulaCompletionSource(sources: readonly FormulaSourceDescriptor[]) {
  const options = completionOptions(sources);
  return (context: CompletionContext): CompletionResult | null => {
    const reference = context.matchBefore(/"[^"\n]*$/);
    if (reference) {
      return {
        from: reference.from,
        options: quotedReferenceCompletionOptions(sources),
      };
    }
    const word = context.matchBefore(/[A-Za-z_]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return {
      from: word.from,
      options: options.filter((option) => option.type === 'function' || option.type === 'keyword'),
    };
  };
}

export function formulaEditorDiagnostics(
  diagnostics: readonly FormulaDiagnostic[],
  message: (diagnostic: FormulaDiagnostic) => string,
): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: diagnostic.from,
    to: Math.max(diagnostic.from, diagnostic.to),
    severity: diagnostic.severity,
    message: message(diagnostic),
  }));
}
