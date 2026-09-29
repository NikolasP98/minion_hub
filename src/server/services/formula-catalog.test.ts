import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  maskSensitive: vi.fn(),
  getFinSettings: vi.fn(),
}));

vi.mock('./rbac.service', () => ({ shouldMaskSensitive: mocks.maskSensitive }));
vi.mock('./finance.service', () => ({ getFinSettings: mocks.getFinSettings }));
vi.mock('./pos.service', () => ({ listSellables: vi.fn() }));
vi.mock('./item-cost.service', () => ({ costForProducts: vi.fn() }));

import type { CoreCtx } from '$server/auth/core-ctx';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import {
  analyzeFormula,
  FORMULA_LANGUAGE_VERSION,
  primaryFormulaOutputType,
  type FormulaSourceDescriptor,
} from '$lib/tables/formula';
import {
  POS_FORMULA_SOURCE_IDS,
  analyzeFormulaDraft,
  formulaCatalogRevision,
  loadFormulaCatalog,
} from './formula-properties.service';

const ctx = { tenantId: 'org-a', profileId: 'profile-a', db: {} } as CoreCtx;
const locals = {} as App.Locals;

function nativeSources(currency: string): FormulaSourceDescriptor[] {
  const type = {
    kind: 'number' as const,
    dimension: 'money' as const,
    currency,
    basis: 'sellable-unit',
  };
  return [
    {
      id: POS_FORMULA_SOURCE_IDS.salePrice,
      label: 'Sale price',
      aliases: ['Precio de venta'],
      type,
      nullable: true,
      source: 'native',
    },
    {
      id: POS_FORMULA_SOURCE_IDS.estimatedUnitCost,
      label: 'Estimated unit cost',
      aliases: ['Costo unitario estimado'],
      type,
      nullable: true,
      source: 'native',
    },
    {
      id: POS_FORMULA_SOURCE_IDS.nativeMargin,
      label: 'Native margin',
      aliases: ['Margen nativo'],
      type,
      nullable: true,
      source: 'native',
    },
  ];
}

function formulaDefinition(
  id: string,
  label: string,
  expression: string,
  sources: FormulaSourceDescriptor[],
): CustomPropertyDefinition {
  const analysis = analyzeFormula(expression, sources);
  if (!analysis.ast || !analysis.outputType || analysis.diagnostics.length)
    throw new Error(`invalid test formula: ${analysis.diagnostics[0]?.code ?? 'unknown'}`);
  return {
    id,
    tableId: 'pos.catalog',
    label,
    description: null,
    type: 'formula',
    rules: {
      type: 'formula',
      expression,
      languageVersion: FORMULA_LANGUAGE_VERSION,
      ast: analysis.ast,
      outputType: analysis.outputType,
      dependencies: analysis.dependencies,
    },
    hasDefault: false,
    defaultValue: null,
    presentation: null,
    version: 1,
    archivedAt: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  };
}

function descriptor(definition: CustomPropertyDefinition): FormulaSourceDescriptor {
  if (definition.rules.type !== 'formula') throw new Error('formula required');
  return {
    id: definition.id,
    label: definition.label,
    aliases: [],
    type: primaryFormulaOutputType(definition.rules),
    nullable: primaryFormulaOutputType(definition.rules).nullable,
    source: 'formula',
  };
}

describe('formula catalog visibility and source drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFinSettings.mockResolvedValue({ currency: 'PEN' });
    mocks.maskSensitive.mockResolvedValue(false);
  });

  it('excludes finance-backed formulas and their dependents from a masked manager catalog', async () => {
    const canonical = nativeSources('PEN');
    const cost = formulaDefinition(
      '00000000-0000-4000-8000-000000000001',
      'Cost formula',
      '"Estimated unit cost"',
      canonical,
    );
    const dependent = formulaDefinition(
      '00000000-0000-4000-8000-000000000002',
      'Cost copy',
      '"Cost formula"',
      [...canonical, descriptor(cost)],
    );
    mocks.maskSensitive.mockResolvedValue(true);

    const catalog = await loadFormulaCatalog(locals, ctx, 'pos.catalog', [cost, dependent]);

    expect(catalog.definitions).toEqual([]);
    expect(catalog.restrictedDefinitionIds).toEqual(
      new Set([
        POS_FORMULA_SOURCE_IDS.estimatedUnitCost,
        POS_FORMULA_SOURCE_IDS.nativeMargin,
        cost.id,
        dependent.id,
      ]),
    );
    expect(catalog.fields.map((field) => field.id)).toEqual([POS_FORMULA_SOURCE_IDS.salePrice]);
    expect(analyzeFormulaDraft('"Cost formula"', catalog).diagnostics).toEqual([
      expect.objectContaining({ code: 'unknown_reference' }),
    ]);
    expect(
      formulaCatalogRevision(
        catalog.definitions,
        catalog.fields.filter((field) => field.source === 'native'),
      ),
    ).not.toBe(formulaCatalogRevision([cost, dependent], catalog.canonicalNativeSources));
  });

  it('keeps currency-drifted formulas visible but marks their full dependent closure unavailable', async () => {
    const penSources = nativeSources('PEN');
    const revenue = formulaDefinition(
      '00000000-0000-4000-8000-000000000003',
      'Revenue proxy',
      '"Sale price"',
      penSources,
    );
    const dependent = formulaDefinition(
      '00000000-0000-4000-8000-000000000004',
      'Revenue copy',
      '"Revenue proxy"',
      [...penSources, descriptor(revenue)],
    );
    mocks.getFinSettings.mockResolvedValue({ currency: 'USD' });

    const catalog = await loadFormulaCatalog(locals, ctx, 'pos.catalog', [revenue, dependent]);

    expect(catalog.definitions).toEqual([revenue, dependent]);
    expect(catalog.restrictedDefinitionIds).toEqual(new Set());
    expect(catalog.unavailableDefinitionIds).toEqual(new Set([revenue.id, dependent.id]));
    expect(catalog.fields.map((field) => field.id)).toEqual([
      POS_FORMULA_SOURCE_IDS.salePrice,
      POS_FORMULA_SOURCE_IDS.estimatedUnitCost,
      POS_FORMULA_SOURCE_IDS.nativeMargin,
    ]);
    expect(catalog.canonicalNativeSources[0]?.type).toMatchObject({ currency: 'USD' });
  });
});
