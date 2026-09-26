import { describe, expect, it } from 'vitest';
import { packLanes } from './lanes';

describe('packLanes', () => {
  it('splits only the boxes that overlap; the rest keep the full width', () => {
    const out = packLanes([
      { start: 600, end: 660 }, // 10:00–11:00
      { start: 615, end: 645 }, // 10:15–10:45 — clashes with the first
      { start: 840, end: 900 }, // 14:00–15:00 — alone
    ]);
    expect(out).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it('chains overlaps into one cluster and reuses a freed lane', () => {
    const out = packLanes([
      { start: 600, end: 660 },
      { start: 630, end: 720 }, // overlaps the first
      { start: 660, end: 700 }, // overlaps the second only → lane 0 is free again
    ]);
    expect(out).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });

  it('is index-aligned whatever the input order', () => {
    const out = packLanes([
      { start: 840, end: 900 },
      { start: 615, end: 645 },
      { start: 600, end: 660 },
    ]);
    expect(out.map((l) => l.lanes)).toEqual([1, 2, 2]);
  });

  it('touching boxes do not split', () => {
    expect(
      packLanes([
        { start: 600, end: 660 },
        { start: 660, end: 720 },
      ]),
    ).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });
});
