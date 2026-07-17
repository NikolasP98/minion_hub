import { describe, expect, it } from 'vitest';
import { formatTime } from './video-time';

describe('formatTime', () => {
  it('formats elapsed video time and safely handles invalid values', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(71)).toBe('1:11');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});
