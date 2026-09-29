import { describe, expect, it } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import {
  legacyFormulaEditorProjection,
  legacyFormulaVariableId,
  projectLegacyFormulaEditors,
} from './formula-variable-legacy.service';

const property = '00000000-0000-4000-8000-000000000001';
const secondaryId = '00000000-0000-4000-8000-000000000002';
const rules = {
  type: 'formula' as const,
  expression: '1',
  languageVersion: 1 as const,
  ast: { kind: 'literal' as const, value: 1, valueType: 'number' as const, from: 0, to: 1 },
  outputType: {
    kind: 'number' as const,
    dimension: 'unitless' as const,
    currency: null,
    basis: null,
    nullable: false,
  },
  dependencies: [],
};
const definition = (id: string, label: string): CustomPropertyDefinition => ({
  id,
  tableId: 'pos.catalog',
  label,
  description: null,
  type: 'formula',
  rules,
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 1,
  archivedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe('legacy formula editor adapter', () => {
  it('derives stable property-scoped UUIDv5 identities', () => {
    const first = legacyFormulaVariableId(property, 'minion:formula-variable:primary:v1');
    expect(first).toBe(legacyFormulaVariableId(property, 'minion:formula-variable:primary:v1'));
    expect(first).not.toBe(
      legacyFormulaVariableId(secondaryId, 'minion:formula-variable:primary:v1'),
    );
    expect(first[14]).toBe('5');
  });

  it('adapts a visible numeric secondary as a stable reference without cloning its math', () => {
    const primary = definition(property, 'Margin'.repeat(10));
    primary.presentation = {
      version: 1,
      number: { style: 'decimal', decimals: 2, currencyDisplay: 'symbol', percentScale: 'whole' },
      tone: 'sign',
      secondary: {
        propertyId: secondaryId,
        format: { style: 'percent', decimals: 1, currencyDisplay: 'symbol', percentScale: 'ratio' },
      },
    };
    const secondary = definition(secondaryId, 'Margin'.repeat(10));
    secondary.rules = { ...rules, expression: '99' };
    const projected = legacyFormulaEditorProjection(
      primary,
      [primary, secondary],
      new Set(),
      new Set(),
    );
    expect(projected?.state).toBe('ready');
    if (projected?.state !== 'ready') return;
    expect(projected.rules.variables).toHaveLength(2);
    expect(projected.rules.variables[1].expression).toBe(`"${secondary.label}"`);
    expect(projected.rules.variables[1].expression).not.toContain('99');
    expect(projected.rules.variables.map(({ name }) => name)).toEqual([
      'MarginMarginMarginMarginMarginMarginMarg',
      'MarginMarginMarginMarginMarginMarginMa 2',
    ]);
  });

  it('preserves singleton number and tone formatting during explicit upgrade', () => {
    const primary = definition(property, 'Margin');
    primary.presentation = {
      version: 1,
      number: { style: 'decimal', decimals: 3, currencyDisplay: 'code', percentScale: 'whole' },
      tone: 'sign',
      secondary: null,
    };
    const projected = legacyFormulaEditorProjection(primary, [primary], new Set(), new Set());
    expect(projected?.state).toBe('ready');
    if (projected?.state !== 'ready') return;
    expect(projected.presentation?.variables[0]).toMatchObject({
      variableId: projected.rules.primaryVariableId,
      tone: 'sign',
      emphasis: 'normal',
      number: { style: 'decimal', decimals: 3 },
    });
  });

  it('does not expose a restricted legacy secondary identity', () => {
    const primary = definition(property, 'Margin');
    primary.presentation = {
      version: 1,
      number: { style: 'auto', decimals: null, currencyDisplay: 'symbol', percentScale: 'whole' },
      tone: 'none',
      secondary: {
        propertyId: secondaryId,
        format: { style: 'auto', decimals: null, currencyDisplay: 'symbol', percentScale: 'whole' },
      },
    };
    expect(
      legacyFormulaEditorProjection(primary, [primary], new Set([secondaryId]), new Set()),
    ).toEqual({
      state: 'restricted',
      sourceVersion: 1,
      code: 'legacy_secondary_restricted',
      canClearLegacyPresentation: false,
    });
    const alreadyRedacted = {
      ...primary,
      presentation: { ...primary.presentation, secondary: null },
      presentationRestricted: true,
    } as CustomPropertyDefinition;
    expect(
      projectLegacyFormulaEditors(
        [alreadyRedacted],
        [primary],
        new Set([secondaryId]),
        new Set(),
      )[0].formulaEditor,
    ).toMatchObject({ state: 'restricted', canClearLegacyPresentation: false });
  });
});
