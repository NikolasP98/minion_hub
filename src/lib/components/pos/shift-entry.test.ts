import { describe, expect, it } from 'vitest';
import { SHIFT_STALE_MS, shiftEntry } from './shift-entry';

const NOW = Date.parse('2026-11-21T20:00:00Z');
const shift = (ageMs: number) => ({
  shift: { openedAt: new Date(NOW - ageMs) },
  summary: { byMethod: { cash: 100, card: 50 } },
});

describe('shiftEntry', () => {
  it('closed: needs attention, no income', () => {
    expect(shiftEntry(null, NOW)).toEqual({
      open: false,
      stale: false,
      attention: true,
      income: 0,
    });
  });
  it('automatic register with no shift yet: nothing to act on', () => {
    expect(shiftEntry(null, NOW, true)).toEqual({
      open: false,
      stale: false,
      attention: false,
      income: 0,
    });
  });
  it('open and fresh: no attention, summed income', () => {
    expect(shiftEntry(shift(60_000), NOW)).toEqual({
      open: true,
      stale: false,
      attention: false,
      income: 150,
    });
  });
  it('open past 16 h: stale, needs attention', () => {
    const e = shiftEntry(shift(SHIFT_STALE_MS + 1), NOW);
    expect(e.stale).toBe(true);
    expect(e.attention).toBe(true);
  });
});
