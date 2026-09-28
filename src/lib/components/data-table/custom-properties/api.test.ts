import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomPropertyManagerActions,
  createCustomPropertyValueActions,
  previewFormula,
} from './api';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';

afterEach(() => vi.unstubAllGlobals());

const definition: CustomPropertyDefinition = {
  id: '10000000-0000-4000-8000-000000000001',
  tableId: 'stock.items',
  label: 'Note',
  description: null,
  type: 'text',
  rules: { type: 'text', maxLength: null },
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 2,
  archivedAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('custom property API actions', () => {
  it('sends the allowlisted table identity when archiving', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ definition: { ...definition, archivedAt: '2026-09-26T01:00:00.000Z' } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await createCustomPropertyManagerActions().lifecycle(definition, {
      tableId: 'stock.items',
      expectedVersion: 2,
      action: 'archive',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tables/properties/${definition.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tableId: 'stock.items',
      expectedVersion: 2,
    });
  });

  it('reports a committed value when only the projection refresh fails', async () => {
    const cell = {
      propertyId: definition.id,
      recordId: 'record-1',
      present: true,
      value: 'Saved',
      effectiveValue: 'Saved',
      version: 3,
      updatedAt: '2026-09-26T01:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ cell }), { status: 200 })),
    );
    const result = await createCustomPropertyValueActions('stock.items', async () => {
      throw new Error('refresh');
    }).save(definition, 'record-1', 'Saved', 2);
    expect(result).toEqual({ cell, refreshFailed: true });
  });

  it('sends the catalog revision with an explicit formula preview', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ diagnostics: [], outputType: null, dependencies: [], rows: [] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await previewFormula({
      tableId: 'stock.items',
      expression: 'ROUND("Sale price", 2)',
      recordIds: ['record-1'],
      catalogRevision: 'catalog-v2',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tableId: 'stock.items',
      expression: 'ROUND("Sale price", 2)',
      recordIds: ['record-1'],
      catalogRevision: 'catalog-v2',
    });
  });
});
