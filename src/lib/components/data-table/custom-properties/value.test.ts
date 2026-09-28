import { describe, expect, it } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import {
  customPropertyDisplay,
  isCustomPropertyRecordAvailable,
  retainedArchivedOptions,
} from './value';

const definition = (patch: Partial<CustomPropertyDefinition>): CustomPropertyDefinition => ({
  id: '10000000-0000-4000-8000-000000000001',
  tableId: 'stock.items',
  label: 'Property',
  description: null,
  type: 'text',
  rules: { type: 'text', maxLength: null },
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 1,
  archivedAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...patch,
});

describe('custom property presentation', () => {
  it('formats date-only values without a timezone shift', () => {
    expect(
      customPropertyDisplay(
        definition({ type: 'date', rules: { type: 'date', min: null, max: null } }),
        '2026-09-01',
        'en',
      ),
    ).toBe('01 Sep 2026');
    expect(
      customPropertyDisplay(
        definition({ type: 'date', rules: { type: 'date', min: null, max: null } }),
        '0001-01-02',
        'es',
      ),
    ).toMatch(/^02 ene 1$/i);
  });

  it('localizes booleans and maps stable option ids to labels', () => {
    expect(
      customPropertyDisplay(
        definition({ type: 'boolean', rules: { type: 'boolean' } }),
        true,
        'es',
        { yes: 'Sí', no: 'No' },
      ),
    ).toBe('Sí');
    const select = definition({
      type: 'select',
      rules: {
        type: 'select',
        options: [
          {
            id: '20000000-0000-4000-8000-000000000001',
            label: 'Azul',
            color: '#3b82f6',
            archivedAt: null,
          },
        ],
      },
    });
    expect(customPropertyDisplay(select, '20000000-0000-4000-8000-000000000001')).toBe('Azul');
  });

  it('allows an archived option only when the record already retains it', () => {
    const select = definition({
      type: 'select',
      rules: {
        type: 'select',
        options: [
          {
            id: '20000000-0000-4000-8000-000000000002',
            label: 'Old',
            color: '#6b7280',
            archivedAt: '2026-09-26T00:00:00.000Z',
          },
        ],
      },
    });
    expect([...retainedArchivedOptions(select, '20000000-0000-4000-8000-000000000002')]).toEqual([
      '20000000-0000-4000-8000-000000000002',
    ]);
    expect(retainedArchivedOptions(select, null).size).toBe(0);
  });

  it('does not project defaults for a record omitted by authorization', () => {
    const bundle = {
      definitions: [],
      values: { available: {} },
      recordAccess: { available: { canEdit: false } },
      canManage: false,
      canEdit: false,
    };
    expect(isCustomPropertyRecordAvailable(bundle, 'available')).toBe(true);
    expect(isCustomPropertyRecordAvailable(bundle, 'masked')).toBe(false);
  });
});
