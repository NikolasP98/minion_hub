import { describe, expect, it } from 'vitest';
import { clipToTrack, MIN_BOX_PX } from './track-clip';

// A 07:00–21:00 grid at 56px/h renders 15 rows (`endHour` keeps its own row).
const TRACK_H = 15 * 56;

describe('clipToTrack (HC-022)', () => {
  it('leaves a box inside the track untouched', () => {
    expect(clipToTrack(56, 42, TRACK_H)).toEqual({
      top: 56,
      height: 42,
      clippedTop: false,
      clippedBottom: false,
    });
  });

  it('pins a before-hours box to the top edge and keeps only the visible part', () => {
    // 06:30–07:30 → top -28, height 56: the 07:00–07:30 half stays.
    expect(clipToTrack(-28, 56, TRACK_H)).toEqual({
      top: 0,
      height: 28,
      clippedTop: true,
      clippedBottom: false,
    });
  });

  it('cuts an after-hours box at the track floor', () => {
    // 21:30–22:30 → top 14.5h, height 56: the 21:30–22:00 half stays.
    expect(clipToTrack(14.5 * 56, 56, TRACK_H)).toEqual({
      top: 14.5 * 56,
      height: 28,
      clippedTop: false,
      clippedBottom: true,
    });
  });

  it('marks both edges for a box longer than the whole track', () => {
    expect(clipToTrack(-100, TRACK_H + 200, TRACK_H)).toEqual({
      top: 0,
      height: TRACK_H,
      clippedTop: true,
      clippedBottom: true,
    });
  });

  it('keeps the readability floor for a sliver, growing into the track', () => {
    // 06:55–07:05 → 5 visible minutes (≈4.7px) still paints MIN_BOX_PX tall.
    const top = clipToTrack(-56 / 12, 56 / 6, TRACK_H)!;
    expect(top.height).toBe(MIN_BOX_PX);
    expect(top.top).toBe(0);
    // Same sliver at the floor: pulled UP so it never leaves the track.
    const bottom = clipToTrack(TRACK_H - 4, 56, TRACK_H)!;
    expect(bottom.top + bottom.height).toBe(TRACK_H);
    expect(bottom.height).toBe(MIN_BOX_PX);
    expect(bottom.clippedBottom).toBe(true);
  });

  it('drops a box that lies entirely outside the track', () => {
    expect(clipToTrack(-120, 60, TRACK_H)).toBeNull(); // ends before startHour
    expect(clipToTrack(TRACK_H, 30, TRACK_H)).toBeNull(); // starts at the floor
    expect(clipToTrack(10, 10, 0)).toBeNull(); // no track yet (SSR)
  });

  it('never mutates the caller’s geometry', () => {
    const box = { top: -28, height: 56 };
    clipToTrack(box.top, box.height, TRACK_H);
    expect(box).toEqual({ top: -28, height: 56 });
  });
});
