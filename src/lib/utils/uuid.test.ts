import { describe, it, expect } from 'vitest';
import { uuid } from './uuid';

describe('uuid', () => {
  it('returns a 36-char string', () => {
    expect(uuid()).toHaveLength(36);
  });

  it('matches UUID v4 format', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('has "4" as 13th character (version)', () => {
    expect(uuid()[14]).toBe('4');
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });
});
