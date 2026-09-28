import { describe, expect, it } from 'vitest';
import { formatPresentedNumber, presentedTone } from './column-presentation-display';
import { DEFAULT_COLUMN_NUMBER_FORMAT, DEFAULT_COLUMN_PRESENTATION } from './column-presentation';

const money = { kind: 'number', dimension: 'money', currency: 'PEN', basis: null } as const;
const percent = { kind: 'number', dimension: 'percent', currency: null, basis: null } as const;

describe('column presentation display', () => {
  it('renders Peruvian currency as symbol or code', () => {
    expect(formatPresentedNumber(12.5, DEFAULT_COLUMN_NUMBER_FORMAT, money, 'es-PE')).toContain(
      'S/',
    );
    expect(
      formatPresentedNumber(
        12.5,
        { ...DEFAULT_COLUMN_NUMBER_FORMAT, currencyDisplay: 'code' },
        money,
        'en',
      ),
    ).toContain('PEN');
  });

  it('supports whole and ratio percent semantics', () => {
    expect(formatPresentedNumber(12.5, DEFAULT_COLUMN_NUMBER_FORMAT, percent, 'en')).toBe('12.5%');
    expect(
      formatPresentedNumber(
        0.125,
        { ...DEFAULT_COLUMN_NUMBER_FORMAT, style: 'percent', percentScale: 'ratio', decimals: 1 },
        percent,
        'en',
      ),
    ).toBe('12.5%');
  });

  it('applies sign tone only to valid numeric values', () => {
    const presentation = { ...DEFAULT_COLUMN_PRESENTATION, tone: 'sign' } as const;
    expect(presentedTone(0, 'valid', presentation)).toBe('positive');
    expect(presentedTone(-1, 'valid', presentation)).toBe('negative');
    expect(presentedTone(-1, 'partial', presentation)).toBeNull();
  });
  it('does not throw for invalid draft precision', () => {
    expect(
      formatPresentedNumber(1, { ...DEFAULT_COLUMN_NUMBER_FORMAT, decimals: 7 }, money, 'es-PE'),
    ).toBeNull();
  });
});
