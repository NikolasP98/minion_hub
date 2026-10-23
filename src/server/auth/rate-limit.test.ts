import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDecisionEventRateLimit, checkRateLimit } from './rate-limit';
afterEach(() => vi.useRealTimers());
describe('weighted, bounded self-observation namespace', () => {
  it('atomically charges each event; denied batches neither partly charge nor extend idle lifetime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    for (let i = 0; i < 5; i++) expect(checkDecisionEventRateLimit('atomic', 20)).toBe(true);
    vi.advanceTimersByTime(59000);
    expect(checkDecisionEventRateLimit('atomic', 20)).toBe(true);
    expect(checkDecisionEventRateLimit('atomic', 1)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(checkDecisionEventRateLimit('atomic', 20)).toBe(true);
    expect(checkDecisionEventRateLimit('atomic', 0)).toBe(false);
    expect(checkDecisionEventRateLimit('atomic', 21)).toBe(false);
  });
  it('rejects an unseen 4097th key without evicting active budgets; charged-idle keys expire at 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    for (let i = 0; i < 4096; i++)
      expect(checkDecisionEventRateLimit(`capacity-${i}`, 20)).toBe(true);
    expect(checkDecisionEventRateLimit('overflow', 1)).toBe(false);
    for (let i = 0; i < 5; i++) expect(checkDecisionEventRateLimit('capacity-0', 20)).toBe(true);
    expect(checkDecisionEventRateLimit('capacity-0', 1)).toBe(false);
    vi.advanceTimersByTime(59999);
    expect(checkDecisionEventRateLimit('overflow', 1)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(checkDecisionEventRateLimit('overflow', 20)).toBe(true);
  });
  it('preserves default weight-one callers and keeps their budgets separate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000000);
    for (let i = 0; i < 5; i++) expect(checkRateLimit('legacy')).toBe(true);
    expect(checkRateLimit('legacy')).toBe(false);
    expect(checkDecisionEventRateLimit('legacy', 20)).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(checkRateLimit('legacy')).toBe(true);
  });
});

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
