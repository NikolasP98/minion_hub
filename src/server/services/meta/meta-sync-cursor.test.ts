import { describe, it, expect } from 'vitest';
import { cursorAfterPage, parseResume, tickStatus } from './meta-sync-cursor';

describe('cursorAfterPage', () => {
  // 2026-09-13 incident: the last page of a window spent the slice budget, the
  // cursor kept the window but no next page, and the window restarted forever.
  it('ends the job when the terminal page used the whole slice budget', () => {
    expect(cursorAfterPage({ i: 0, targetCount: 1, currentWindow: '2026-06-15' })).toBeNull();
  });

  it('moves to the next window, never back to page one of the current one', () => {
    const next = cursorAfterPage({ i: 0, targetCount: 1, currentWindow: 'a', nextWindow: 'b' });
    expect(parseResume(next)).toEqual({ i: 0, cs: 'b', next: undefined, f: undefined });
  });

  it('keeps paging inside the window and strips credentials', () => {
    const next = cursorAfterPage({
      i: 0,
      targetCount: 1,
      currentWindow: 'a',
      nextPage: 'https://graph.facebook.com/x?after=1&access_token=t&appsecret_proof=p',
    });
    expect(parseResume(next)).toMatchObject({
      cs: 'a',
      next: 'https://graph.facebook.com/x?after=1',
    });
  });
});

describe('tickStatus', () => {
  it('is 200 when idle or when at least one job ran', () => {
    expect(tickStatus([], [])).toBe(200);
    expect(tickStatus([{ ok: true }, { ok: false }], [])).toBe(200);
  });
  it('is 500 when every claimed job threw', () => {
    expect(tickStatus([{ ok: false }, { ok: false }], [])).toBe(500);
  });
  it('is 503 when a sync kind has been stale for over a day', () => {
    expect(tickStatus([{ ok: true }], ['org:ads'])).toBe(503);
  });
});
