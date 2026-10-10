import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FEATURE_DEFAULTS,
  resolveFeatures,
  type CalendarFeature,
} from './calendar-features';

describe('resolveFeatures', () => {
  /** The defaults table, spelled out: this is the POS behaviour contract, so a
   *  flag flipping default is a deliberate edit here, never a silent one. */
  const table: Array<[CalendarFeature, boolean]> = [
    ['fanOut', false],
    ['merge', true],
    ['createDrag', true],
    ['createDblClick', true],
    ['nowLine', true],
    ['offHours', true],
    ['kebab', true],
    ['colorPicker', true],
    ['fieldsMenu', true],
    ['weekDaysStepper', true],
    ['split', true],
    ['datePicker', true],
    ['agenda', false],
  ];

  it.each(table)('%s defaults to %s', (flag, expected) => {
    expect(resolveFeatures()[flag]).toBe(expected);
  });

  it('covers every flag with no extras', () => {
    expect(Object.keys(resolveFeatures()).sort()).toEqual(table.map(([f]) => f).sort());
  });

  it('keeps the defaults for an empty or missing partial', () => {
    expect(resolveFeatures()).toEqual({ ...CALENDAR_FEATURE_DEFAULTS });
    expect(resolveFeatures({})).toEqual({ ...CALENDAR_FEATURE_DEFAULTS });
  });

  it('applies only the stated flags', () => {
    const f = resolveFeatures({ merge: false, agenda: true });
    expect(f.merge).toBe(false);
    expect(f.agenda).toBe(true);
    expect(f.fanOut).toBe(false);
  });

  it('treats an undefined entry as not stated', () => {
    expect(resolveFeatures({ merge: undefined }).merge).toBe(true);
  });

  it('ignores unknown keys', () => {
    expect(resolveFeatures({ bogus: true } as Partial<Record<CalendarFeature, boolean>>)).toEqual({
      ...CALENDAR_FEATURE_DEFAULTS,
    });
  });
});
