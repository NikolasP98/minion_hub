import { describe, it, expect } from 'vitest';
import { overlapSince } from './finance-sync.helpers';

describe('overlapSince', () => {
  it('returns undefined for a null watermark (full backfill)', () => {
    expect(overlapSince(null)).toBeUndefined();
  });
  it('rewinds the watermark by the overlap window', () => {
    const out = overlapSince('2026-06-01T00:05:00.000Z', 5 * 60 * 1000);
    expect(out).toBe('2026-06-01T00:00:00.000Z');
  });
});
