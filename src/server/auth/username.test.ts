import { describe, it, expect } from 'vitest';
import { normalizeUsername } from './username';

describe('normalizeUsername', () => {
  it('lowercases and trims a valid username', () => {
    expect(normalizeUsername('  Nikolas_P  ')).toBe('nikolas_p');
  });

  it('accepts dots, dashes, underscores in the middle', () => {
    expect(normalizeUsername('nik.p-98_x')).toBe('nik.p-98_x');
  });

  it('rejects usernames shorter than 3 chars', () => {
    expect(normalizeUsername('ab')).toBeNull();
  });

  it('rejects usernames longer than 32 chars', () => {
    expect(normalizeUsername('a'.repeat(33))).toBeNull();
  });

  it('accepts the 32-char boundary', () => {
    expect(normalizeUsername('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('rejects an email-shaped identifier (contains @)', () => {
    expect(normalizeUsername('nik@example.com')).toBeNull();
  });

  it('rejects a leading/trailing separator', () => {
    expect(normalizeUsername('-nikolas')).toBeNull();
    expect(normalizeUsername('nikolas-')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(normalizeUsername('')).toBeNull();
  });
});
