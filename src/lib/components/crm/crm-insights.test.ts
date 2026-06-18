import { describe, it, expect } from 'vitest';
import { isStopword, isWordlike, monthKey, scoreToLabel, wordSize } from './crm-insights';

describe('isStopword', () => {
  it('filters common chat noise (case-insensitive)', () => {
    expect(isStopword('Hola')).toBe(true);
    expect(isStopword('gracias')).toBe(true);
    expect(isStopword('rinoplastia')).toBe(false);
  });
});

describe('isWordlike', () => {
  it('keeps real words, drops commands/numbers/punctuation', () => {
    expect(isWordlike('dolor')).toBe(true);
    expect(isWordlike('rinoplastia')).toBe(true);
    expect(isWordlike('/new')).toBe(false);
    expect(isWordlike('123')).toBe(false);
    expect(isWordlike('p2p')).toBe(false);
  });
});

describe('monthKey', () => {
  it('formats a date as YYYY-MM (UTC)', () => {
    expect(monthKey(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('scoreToLabel', () => {
  it('buckets sentiment scores', () => {
    expect(scoreToLabel(0.8)).toBe('positive');
    expect(scoreToLabel(0.25)).toBe('positive');
    expect(scoreToLabel(0)).toBe('neutral');
    expect(scoreToLabel(-0.24)).toBe('neutral');
    expect(scoreToLabel(-0.5)).toBe('negative');
  });
});

describe('wordSize', () => {
  it('sqrt-scales counts into the px range, clamped', () => {
    expect(wordSize(1, 1, 1)).toBe(12); // min==max → low end
    expect(wordSize(100, 1, 100)).toBe(48); // max → high end
    const mid = wordSize(25, 1, 100);
    expect(mid).toBeGreaterThan(12);
    expect(mid).toBeLessThan(48);
  });
});
