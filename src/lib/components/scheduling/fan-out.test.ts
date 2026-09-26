import { describe, expect, it } from 'vitest';
import { fanKey, fanLayout, type FanMember } from './fan-out';

/** A container member: every member of a normalised visit carries the SAME
 *  window plus its own `groupLength`. */
const mb = (id: string, groupLength: number | null): FanMember => ({
  id,
  start: '2026-09-26T14:00:00.000Z',
  end: '2026-09-26T15:00:00.000Z',
  groupLength,
});

describe('fanKey', () => {
  it('keys per column, so day view can fan the same box in either column', () => {
    expect(fanKey('__all__', 'b1')).toBe('__all__ b1');
    expect(fanKey('res-9', 'b1')).not.toBe(fanKey('__all__', 'b1'));
  });
});

describe('fanLayout', () => {
  // The grid the POS calendar renders: 56px per hour, 18px minimum box.
  const lay = (members: FanMember[], top = 100) => fanLayout(members, top, 56, 18);

  it('stacks members from the container top, each as tall as its own minutes', () => {
    // 15 min is 14px, under the 18px floor every box has — so the two quarter
    // hours are drawn at 18px while the stack still advances 14px per member.
    const out = lay([mb('a', 30), mb('b', 15), mb('c', 15)]);
    expect(out).toEqual([
      { id: 'a', top: 100, height: 28 },
      { id: 'b', top: 128, height: 18 },
      { id: 'c', top: 142, height: 18 },
    ]);
  });

  it('falls back to the member window when it carries no groupLength (legacy rows)', () => {
    const out = lay([
      { id: 'a', start: '2026-09-26T14:00:00.000Z', end: '2026-09-26T14:30:00.000Z' },
      { id: 'b', start: '2026-09-26T14:30:00.000Z', end: '2026-09-26T15:00:00.000Z' },
    ]);
    expect(out.map((s) => [s.top, s.height])).toEqual([
      [100, 28],
      [128, 28],
    ]);
  });

  it('floors the height but advances by the true minutes', () => {
    // A 5-minute procedure would be a 4.7px hairline: it is drawn at 18px and
    // overlaps its neighbour instead of pushing the deck past the container.
    const out = lay([mb('a', 5), mb('b', 30)]);
    expect(out[0]).toEqual({ id: 'a', top: 100, height: 18 });
    expect(out[1].top).toBeCloseTo(100 + (5 / 60) * 56);
  });

  it('never returns a negative height for a bad length', () => {
    expect(lay([mb('a', -30)])[0].height).toBe(18);
  });

  it('is empty for no members', () => {
    expect(lay([])).toEqual([]);
  });
});
