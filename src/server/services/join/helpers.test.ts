import { describe, test, expect } from 'vitest';
import { generateOpaqueToken, isLinkUsable } from './helpers';

describe('generateOpaqueToken', () => {
  test('is url-safe and unique', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('isLinkUsable', () => {
  const now = new Date('2026-05-25T00:00:00Z');
  const base = { revoked: false, expiresAt: null as Date | null, maxUses: null as number | null, usesCount: 0 };
  test('usable by default', () => expect(isLinkUsable(base, now)).toBe(true));
  test('revoked → false', () => expect(isLinkUsable({ ...base, revoked: true }, now)).toBe(false));
  test('expired → false', () =>
    expect(isLinkUsable({ ...base, expiresAt: new Date('2026-05-24T00:00:00Z') }, now)).toBe(false));
  test('maxed → false', () =>
    expect(isLinkUsable({ ...base, maxUses: 2, usesCount: 2 }, now)).toBe(false));
  test('under max → true', () =>
    expect(isLinkUsable({ ...base, maxUses: 2, usesCount: 1 }, now)).toBe(true));
});
