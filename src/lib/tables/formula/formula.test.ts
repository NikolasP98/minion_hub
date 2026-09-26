import { describe, expect, it } from 'vitest';
import type { FormulaSourceDescriptor } from './contracts';
import { analyzeFormula } from './typecheck';
import { formatFormulaAst } from './format';

const number = { kind: 'number', dimension: 'unitless', currency: null, basis: null } as const;
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
  {
    id: 'property:n',
    label: 'Units',
    aliases: [],
    type: number,
    nullable: false,
    source: 'custom',
  },
  {
    id: 'property:t',
    label: 'Note',
    aliases: [],
    type: { kind: 'text' },
    nullable: true,
    source: 'custom',
  },
];

describe('formula parser and type checker', () => {
  it('resolves localized labels to stable ids and infers money', () => {
    const result = analyzeFormula(
      'ROUND("Precio de venta" - "Costo unitario estimado", 2)',
      sources,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.dependencies.map((d) => d.id)).toEqual(['native:price', 'native:cost']);
    expect(result.outputType).toMatchObject({
      kind: 'number',
      dimension: 'money',
      currency: 'PEN',
    });
  });

  it('diagnoses incompatible arithmetic and ambiguous labels', () => {
    expect(analyzeFormula('"Units" + "Note"', sources).diagnostics[0]?.code).toBe('type_mismatch');
    const ambiguous = [...sources, { ...sources[2], id: 'property:other' }];
    expect(analyzeFormula('"Units"', ambiguous).diagnostics[0]?.code).toBe('ambiguous_reference');
  });

  it('parses lazy CASE, SQL escaping and null predicates', () => {
    const result = analyzeFormula(
      `CASE WHEN "Note" IS NULL THEN 'it''s blank' ELSE "Note" END`,
      sources,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.outputType).toEqual({ kind: 'text', nullable: true });
  });

  it('requires a bounded literal ROUND precision', () => {
    expect(
      analyzeFormula('ROUND("Units", "Units")', sources).diagnostics.some(
        (d) => d.code === 'invalid_precision',
      ),
    ).toBe(true);
    expect(
      analyzeFormula('ROUND("Units", 13)', sources).diagnostics.some(
        (d) => d.code === 'invalid_precision',
      ),
    ).toBe(true);
  });

  it('unifies SQL NULL contextually and ignores nullable in scalar compatibility', () => {
    expect(analyzeFormula('"Sale price" - "Estimated unit cost"', sources).diagnostics).toEqual([]);
    expect(analyzeFormula(`COALESCE(NULL, 'fallback')`, sources).outputType).toEqual({
      kind: 'text',
      nullable: false,
    });
    expect(
      analyzeFormula(`CASE WHEN TRUE THEN "Sale price" ELSE NULL END`, sources).outputType,
    ).toMatchObject({ kind: 'number', dimension: 'money', nullable: true });
    expect(
      analyzeFormula(`NULLIF("Sale price", 0)`, sources).diagnostics.some(
        (d) => d.code === 'type_mismatch',
      ),
    ).toBe(true);
  });

  it('renders persisted stable references with current escaped labels and round trips', () => {
    const analyzed = analyzeFormula(`ROUND("Sale price" - "Estimated unit cost", 2)`, sources);
    const renamed = sources.map((source) =>
      source.id === 'native:price' ? { ...source, label: 'Price "current"' } : source,
    );
    const rendered = formatFormulaAst(analyzed.ast!, renamed);
    expect(rendered).toBe(`ROUND("Price ""current""" - "Estimated unit cost", 2)`);
    expect(analyzeFormula(rendered, renamed).dependencies).toEqual(analyzed.dependencies);
  });
});
