import { describe, expect, it } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import {
  customPropertyDateInput,
  customPropertyDateValue,
  customPropertyDisplay,
  formatCustomPropertyDate,
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

  it('renders a date-only value under each date format', () => {
    const at = (dateFormat: 'full' | 'short' | 'mdy' | 'dmy' | 'ymd' | 'relative') =>
      formatCustomPropertyDate(
        '2026-06-15',
        { type: 'date', min: null, max: null, dateFormat },
        'en',
        new Date(2026, 5, 16, 12),
      );
    expect(at('full')).toBe('15 Jun 2026');
    expect(at('short')).toBe('6/15/26');
    expect(at('mdy')).toBe('06/15/2026');
    expect(at('dmy')).toBe('15/06/2026');
    expect(at('ymd')).toBe('2026/06/15');
    // `now` is injected, so "relative" is pinnable; the viewer's zone decides its today.
    expect(at('relative')).toBe('yesterday');
    expect(
      formatCustomPropertyDate(
        '2026-06-16',
        { type: 'date', min: null, max: null, dateFormat: 'relative' },
        'en',
        new Date(2026, 5, 16, 12),
      ),
    ).toBe('today');
  });

  it('hides the clock unless the column asks for it, and never shifts a date-only day', () => {
    const rules = (timeFormat: 'hidden' | '12h' | '24h') =>
      ({
        type: 'date',
        min: null,
        max: null,
        includeTime: true,
        dateFormat: 'ymd',
        timeFormat,
      }) as const;
    const instant = '2026-06-15T14:05:00.000Z';
    expect(formatCustomPropertyDate(instant, rules('hidden'), 'en')).not.toMatch(/\d:\d/);
    expect(formatCustomPropertyDate(instant, rules('24h'), 'en')).toMatch(
      /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
    );
    expect(formatCustomPropertyDate(instant, rules('12h'), 'en')).toMatch(/(AM|PM)$/);
    // A date-only value has no clock to show even on a time-enabled column.
    expect(formatCustomPropertyDate('2026-06-15', rules('24h'), 'en')).toBe('2026/06/15');
    expect(formatCustomPropertyDate('not a date', rules('24h'), 'en')).toBe('');
  });

  it('round-trips the editor input text through the stored value', () => {
    expect(customPropertyDateInput('2026-06-15', false)).toBe('2026-06-15');
    expect(customPropertyDateInput('2026-06-15', true)).toBe('2026-06-15T00:00');
    expect(customPropertyDateInput(null, true)).toBe('');
    expect(customPropertyDateValue('', true)).toBe(null);
    expect(customPropertyDateValue('2026-06-15', false)).toBe('2026-06-15');
    // A time-enabled column drops an instant back out as the SAME local wall clock.
    const stored = customPropertyDateValue('2026-06-15T14:05', true);
    expect(stored).not.toBe(null);
    expect(customPropertyDateInput(stored, true)).toBe('2026-06-15T14:05');
    expect(customPropertyDateValue('2026-06-15T14:05', false)).toBe('2026-06-15');
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
