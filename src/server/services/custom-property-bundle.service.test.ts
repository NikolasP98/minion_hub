import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inspectAccess: vi.fn(),
  authorizeRecords: vi.fn(),
  listProperties: vi.fn(),
  readValues: vi.fn(),
  loadCatalog: vi.fn(),
  loadInputs: vi.fn(),
  scalarInputs: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock('./custom-properties-access', () => ({
  inspectCustomPropertyAccess: mocks.inspectAccess,
}));
vi.mock('./custom-property-entities.service', () => ({
  authorizeCustomPropertyRecords: mocks.authorizeRecords,
}));
vi.mock('./custom-properties.service', () => ({
  CustomPropertyError: class CustomPropertyError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
  listCustomProperties: mocks.listProperties,
  readCustomPropertyValues: mocks.readValues,
}));
vi.mock('./formula-properties.service', () => ({
  loadFormulaCatalog: mocks.loadCatalog,
  loadFormulaInputs: mocks.loadInputs,
  formulaInputsFromCustomValues: mocks.scalarInputs,
  evaluateFormulaDefinitions: mocks.evaluate,
}));

import type { CoreCtx } from '$server/auth/core-ctx';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { loadCustomPropertyBundle } from './custom-property-bundle.service';

const ctx = { tenantId: 'org-a', profileId: 'profile-a', db: {} } as CoreCtx;
const locals: App.Locals = {
  user: {
    id: 'user-a',
    supabaseId: 'profile-a',
    email: 'custom-properties@qa.minion.test',
    displayName: 'Custom properties tester',
    role: 'user',
  },
};

describe('loadCustomPropertyBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectAccess.mockResolvedValue({ canManage: true, canEdit: true });
    mocks.listProperties.mockResolvedValue([]);
    mocks.loadCatalog.mockImplementation(async (_locals, _ctx, _tableId, definitions) => ({
      definitions,
      fields: [],
      restrictedDefinitionIds: new Set(),
      unavailableDefinitionIds: new Set(),
      currency: null,
    }));
    mocks.loadInputs.mockResolvedValue({});
    mocks.scalarInputs.mockReturnValue({});
    mocks.evaluate.mockResolvedValue({ cells: {} });
    mocks.authorizeRecords.mockImplementation(
      async (_locals, _ctx, _tableId, recordIds: string[]) =>
        Object.fromEntries(recordIds.map((id) => [id, { canEdit: true }])),
    );
    mocks.readValues.mockImplementation(async (_ctx, _tableId, recordIds: string[]) =>
      Object.fromEntries(recordIds.map((id) => [id, {}])),
    );
  });

  it('authorizes and reads 501 requested records in bounded chunks without dropping records', async () => {
    const recordIds = Array.from({ length: 501 }, (_, index) => `record-${index}`);

    const bundle = await loadCustomPropertyBundle(locals, ctx, 'stock.items', recordIds);

    expect(mocks.authorizeRecords).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeRecords.mock.calls.map((call) => call[3].length)).toEqual([500, 1]);
    expect(mocks.readValues).toHaveBeenCalledTimes(2);
    expect(mocks.readValues.mock.calls.map((call) => call[2].length)).toEqual([500, 1]);
    expect(Object.keys(bundle.recordAccess)).toHaveLength(501);
    expect(Object.keys(bundle.values)).toHaveLength(501);
    expect(bundle.recordAccess['record-500']).toEqual({ canEdit: true });
    expect(bundle.values['record-500']).toEqual({});
  });

  it('retries when the definition graph changes and returns only the consistent snapshot', async () => {
    const first = {
      id: 'property-a',
      version: 1,
      archivedAt: null,
      rules: { type: 'text' },
    } as CustomPropertyDefinition;
    const second = { ...first, version: 2 } as CustomPropertyDefinition;
    mocks.listProperties
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([second]);
    mocks.readValues
      .mockResolvedValueOnce({
        'record-a': {
          'property-a': {
            propertyId: 'property-a',
            recordId: 'record-a',
            present: true,
            value: 1,
            effectiveValue: 1,
            version: 1,
            updatedAt: null,
          },
        },
      })
      .mockResolvedValueOnce({
        'record-a': {
          'property-a': {
            propertyId: 'property-a',
            recordId: 'record-a',
            present: true,
            value: 2,
            effectiveValue: 2,
            version: 2,
            updatedAt: null,
          },
        },
      });

    const bundle = await loadCustomPropertyBundle(locals, ctx, 'stock.items', ['record-a']);

    expect(mocks.readValues).toHaveBeenCalledTimes(2);
    expect(bundle.definitions).toEqual([second]);
    expect(bundle.values['record-a']['property-a']).toMatchObject({
      effectiveValue: 2,
      definitionVersion: 2,
    });
  });

  it('merges supplied canonical native inputs with freshly read custom values', async () => {
    mocks.inspectAccess.mockResolvedValue({ canManage: false, canEdit: true });
    const formula = {
      id: 'formula-a',
      version: 4,
      archivedAt: null,
      rules: { type: 'formula' },
    } as CustomPropertyDefinition;
    mocks.listProperties.mockResolvedValue([formula]);
    mocks.scalarInputs.mockReturnValue({
      'record-a': {
        'custom-a': {
          value: 7,
          quality: 'valid',
          code: null,
          sourceUpdatedAt: null,
        },
      },
    });
    mocks.evaluate.mockResolvedValue({ cells: { 'record-a': {} } });
    const native = {
      value: 12,
      quality: 'valid' as const,
      code: null,
      sourceUpdatedAt: null,
    };

    await loadCustomPropertyBundle(locals, ctx, 'pos.catalog', ['record-a'], {
      formulaNativeInputs: { 'record-a': { 'native:price': native } },
    });

    expect(mocks.evaluate).toHaveBeenCalledWith(
      ctx,
      [formula],
      [],
      expect.objectContaining({
        'record-a': expect.objectContaining({
          'custom-a': expect.any(Object),
          'native:price': native,
        }),
      }),
    );
    expect(mocks.loadInputs).not.toHaveBeenCalled();
  });

  it('keeps unavailable formulas visible as source-type errors without evaluating them', async () => {
    mocks.inspectAccess.mockResolvedValue({ canManage: false, canEdit: true });
    const formula = {
      id: 'formula-a',
      version: 4,
      archivedAt: null,
      rules: {
        type: 'formula',
        outputType: { kind: 'number', dimension: 'money', currency: 'PEN', basis: 'sellable-unit' },
      },
    } as CustomPropertyDefinition;
    mocks.listProperties.mockResolvedValue([formula]);
    mocks.loadCatalog.mockResolvedValue({
      definitions: [formula],
      fields: [],
      restrictedDefinitionIds: new Set(),
      unavailableDefinitionIds: new Set(['formula-a']),
      currency: 'PEN',
    });

    const bundle = await loadCustomPropertyBundle(locals, ctx, 'pos.catalog', ['record-a']);

    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(bundle.definitions).toEqual([formula]);
    expect(bundle.values['record-a']['formula-a']).toMatchObject({
      computed: true,
      effectiveValue: null,
      definitionVersion: 4,
      formula: { quality: 'error', code: 'source_type_changed', currency: 'PEN' },
    });
  });
});
