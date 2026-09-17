import { describe, expect, it } from 'vitest';
import { checkRateLimit } from './rate-limit.js';

// A fresh key per test — the limiter's Map is module-level/global, so reusing
// a key across tests would leak state between them.
let counter = 0;
const freshKey = (tag: string) => `${tag}:${counter++}`;

describe('checkRateLimit', () => {
  it('defaults to 5 requests per 60s window', () => {
    const key = freshKey('default');
    for (let i = 0; i < 5; i++) expect(checkRateLimit(key)).toBe(true);
    expect(checkRateLimit(key)).toBe(false);
  });

  it('honors a caller-supplied higher limit (e.g. dev-switch-user 60/min)', () => {
    const key = freshKey('high-limit');
    for (let i = 0; i < 60; i++) expect(checkRateLimit(key, 60)).toBe(true);
    expect(checkRateLimit(key, 60)).toBe(false);
  });

  it('keeps separate keys independent regardless of their limit', () => {
    const loginKey = freshKey('login');
    const switchKey = freshKey('switch');
    for (let i = 0; i < 5; i++) checkRateLimit(loginKey, 5);
    expect(checkRateLimit(loginKey, 5)).toBe(false);
    // A different key with a higher limit is unaffected by the first key's exhaustion.
    expect(checkRateLimit(switchKey, 60)).toBe(true);
  });

  it('honors a caller-supplied window: a request outside windowMs is not counted', () => {
    const key = freshKey('window');
    // windowMs=0 means "now - t < 0" is never true for a just-recorded hit,
    // so every call sees an empty recent window and always succeeds.
    for (let i = 0; i < 10; i++) expect(checkRateLimit(key, 1, 0)).toBe(true);
  });
});
