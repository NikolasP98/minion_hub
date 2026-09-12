import { describe, it, expect } from 'vitest';
import { summarizeTags } from './tag-summary';

describe('summarizeTags', () => {
  it('shows everything and no extra when under the max', () => {
    expect(summarizeTags(['a', 'b'])).toEqual({ shown: ['a', 'b'], extra: 0 });
  });

  it('caps at max (default 3) and counts the rest as extra', () => {
    expect(summarizeTags(['a', 'b', 'c', 'd', 'e'])).toEqual({
      shown: ['a', 'b', 'c'],
      extra: 2,
    });
  });

  it('handles empty input', () => {
    expect(summarizeTags([])).toEqual({ shown: [], extra: 0 });
  });

  it('honours a custom max', () => {
    expect(summarizeTags(['a', 'b', 'c'], 1)).toEqual({ shown: ['a'], extra: 2 });
  });
});
