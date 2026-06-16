import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedIdentity,
  setCachedIdentity,
  invalidateCachedIdentity,
  clearIdentityCache,
  identityCacheSize,
} from './identity-cache.js';

describe('identity-cache', () => {
  beforeEach(() => clearIdentityCache());

  it('returns null on a miss and the value on a hit', () => {
    expect(getCachedIdentity('k')).toBeNull();
    setCachedIdentity('k', { user: 'a' });
    expect(getCachedIdentity('k')).toEqual({ user: 'a' });
  });

  it('expires entries after the TTL window', () => {
    const t0 = 1_000_000;
    setCachedIdentity('k', 42, t0);
    // Just inside the default 60s TTL → still present.
    expect(getCachedIdentity('k', t0 + 59_000)).toBe(42);
    // Past the TTL → evicted and returns null.
    expect(getCachedIdentity('k', t0 + 61_000)).toBeNull();
    expect(identityCacheSize()).toBe(0);
  });

  it('invalidate drops a single entry', () => {
    setCachedIdentity('a', 1);
    setCachedIdentity('b', 2);
    invalidateCachedIdentity('a');
    expect(getCachedIdentity('a')).toBeNull();
    expect(getCachedIdentity('b')).toBe(2);
  });

  it('keys are distinct per (token, org) string', () => {
    setCachedIdentity('tok org1', 'one');
    setCachedIdentity('tok org2', 'two');
    expect(getCachedIdentity('tok org1')).toBe('one');
    expect(getCachedIdentity('tok org2')).toBe('two');
  });

  it('a hit refreshes recency without resetting the TTL', () => {
    const t0 = 5_000;
    setCachedIdentity('k', 'v', t0);
    // Touch near the end of the window — must NOT extend the original expiry.
    expect(getCachedIdentity('k', t0 + 50_000)).toBe('v');
    expect(getCachedIdentity('k', t0 + 61_000)).toBeNull();
  });
});
