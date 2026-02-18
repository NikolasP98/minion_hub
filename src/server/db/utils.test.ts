import { describe, it, expect } from 'vitest';
import { newId, nowMs } from './utils';

describe('newId', () => {
  it('returns a 24-char string', () => {
    expect(newId()).toHaveLength(24);
  });

  it('contains only alphanumeric chars', () => {
    expect(newId()).toMatch(/^[a-z0-9]+$/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });
});

describe('nowMs', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now();
    const result = nowMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});
