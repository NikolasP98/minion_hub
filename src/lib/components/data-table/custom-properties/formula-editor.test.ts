import { describe, expect, it } from 'vitest';
import type { FormulaSourceDescriptor } from '$lib/tables/formula';
import {
  analyzeFormulaDraft,
  completionOptions,
  formulaEditorDiagnostics,
  quotedReferenceCompletionOptions,
} from './formula-editor';

const money = {
  kind: 'number',
  dimension: 'money',
  currency: 'PEN',
  basis: 'sellable-unit',
} as const;
const sources: FormulaSourceDescriptor[] = [
  {
    id: 'native:price',
    label: 'Sale price',
    aliases: ['Precio de venta'],
    type: money,
    nullable: true,
    source: 'native',
  },
  {
    id: 'native:cost',
    label: 'Estimated unit cost',
    aliases: ['Costo unitario estimado'],
    type: money,
    nullable: true,
    source: 'native',
  },
];

describe('formula editor helpers', () => {
  it('analyzes a typed localized margin without a request', () => {
    const analysis = analyzeFormulaDraft(
      'ROUND("Precio de venta" - "Costo unitario estimado", 2)',
      sources,
    );
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.outputType).toMatchObject({
      kind: 'number',
      dimension: 'money',
      currency: 'PEN',
    });
  });

  it('offers localized references and function signatures', () => {
    const options = completionOptions(sources);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Precio de venta', apply: '"Precio de venta"' }),
        expect.objectContaining({ label: 'ROUND', detail: 'ROUND(value, precision)' }),
      ]),
    );
  });

  it('keeps quoted reference labels compatible with CodeMirror filtering', () => {
    expect(quotedReferenceCompletionOptions(sources)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '"Sale price"',
          displayLabel: 'Sale price',
          apply: '"Sale price"',
        }),
      ]),
    );
  });

  it('maps parser ranges into CodeMirror diagnostics', () => {
    const analysis = analyzeFormulaDraft('"Unknown" + 1', sources);
    const diagnostics = formulaEditorDiagnostics(
      analysis.diagnostics,
      (diagnostic) => diagnostic.code,
    );
    expect(diagnostics[0]).toMatchObject({ severity: 'error', message: 'unknown_reference' });
    expect(diagnostics[0].to).toBeGreaterThan(diagnostics[0].from);
  });
});
