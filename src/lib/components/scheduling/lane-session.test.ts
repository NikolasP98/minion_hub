import { describe, expect, it } from 'vitest';
import { mergeLanes } from './lane-session';

describe('mergeLanes (HC-018: append-only, order-stable lane session)', () => {
  it('starts from the seen order when the session is empty', () => {
    expect(mergeLanes([], ['accepted', 'completed'])).toEqual(['accepted', 'completed']);
  });

  it('appends a newly seen value AFTER the existing lanes, never re-sorting', () => {
    // `pending` ranks between the two existing lanes in the registry, so the
    // caller hands it over pre-sorted — the session still keeps it last.
    expect(mergeLanes(['accepted', 'completed'], ['accepted', 'pending', 'completed'])).toEqual([
      'accepted',
      'completed',
      'pending',
    ]);
  });

  it('keeps the unclassified lane trailing and inserts new values before it', () => {
    expect(mergeLanes(['a', null], ['a', 'b', null])).toEqual(['a', 'b', null]);
    expect(mergeLanes(['a'], ['b', null])).toEqual(['a', 'b', null]);
  });

  it('never removes a lane because its value scrolled out of the window', () => {
    expect(mergeLanes(['a', 'b', null], ['b'])).toEqual(['a', 'b', null]);
    expect(mergeLanes(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns the same array when nothing changed (no churn for effects)', () => {
    const existing = ['a', 'b', null];
    expect(mergeLanes(existing, ['b', 'a', null])).toBe(existing);
  });
});
