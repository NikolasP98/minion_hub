import { describe, expect, it } from 'vitest';
import { parseTimeOffParams } from './time-off-calendar-params';

describe('parseTimeOffParams', () => {
  it('falls back to the caller defaults when absent', () => {
    expect(parseTimeOffParams(new URLSearchParams(), '2026-10-11', 'month')).toEqual({
      date: '2026-10-11',
      view: 'month',
    });
  });

  it('restores a bookmarked date and view', () => {
    expect(
      parseTimeOffParams(new URLSearchParams('date=2026-03-05&cal=week'), '2026-10-11', 'month'),
    ).toEqual({ date: '2026-03-05', view: 'week' });
  });

  it('ignores a malformed date or an unknown view, per field', () => {
    expect(
      parseTimeOffParams(new URLSearchParams('date=bad&cal=nope'), '2026-10-11', 'month'),
    ).toEqual({ date: '2026-10-11', view: 'month' });
    expect(
      parseTimeOffParams(new URLSearchParams('date=2026-03-05'), '2026-10-11', 'month'),
    ).toEqual({ date: '2026-03-05', view: 'month' });
  });
});
