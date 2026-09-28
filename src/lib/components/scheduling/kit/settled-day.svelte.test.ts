/**
 * NOT wrapped in `$effect.root`.
 *
 * TODO(handoff): this repo's bun+vitest+`@sveltejs/vite-plugin-svelte` setup
 * silently never invokes an `$effect.root(fn)` callback — `fn` is created but
 * never runs, so any assertion placed only INSIDE a `$effect.root` block
 * passes vacuously (verified directly: `expect(1).toBe(2)` inside one still
 * reports a green test). The shipped `src/lib/state/async.svelte.test.ts`
 * uses exactly this pattern for its `createAsyncResource` describe block, so
 * those specific assertions are almost certainly false-green too (its
 * `createConnectedFetch` tests don't use `$effect.root` and are unaffected).
 * `$state`/`$derived` read/write correctly with NO owning root at all when
 * called directly (confirmed empirically), so every kit test here calls the
 * factories directly instead of wrapping in `$effect.root`. A bare `$effect`
 * (used internally by `createSettledDay` and `calendar-prefs.svelte.ts`) DOES
 * still run once, synchronously, at creation with no root — but with no owner
 * to schedule it, it never RE-runs when one of its reads changes afterward
 * (confirmed: neither a second read nor an explicit `flushSync()` retriggers
 * it). That means the "re-seed `settledDay` when `pageDay` changes" behavior
 * — this module's actual reason to exist — cannot be unit-tested in this
 * harness; it's covered instead by this slice's required browser
 * verification (day navigation on the live POS page). Ledgered:
 * proposals/2026-09-25-hub-pos-calendar-color-followups.md (this slice's
 * followups section) — root-causing the vitest/svelte-plugin interaction is
 * out of scope for this slice.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSettledDay } from './settled-day.svelte';

describe('createSettledDay', () => {
  it('starts at pageDay() before any settle', () => {
    const settled = createSettledDay({
      pageDay: () => '2026-09-25',
      view: () => 'week',
      replaceUrl: vi.fn(),
    });
    expect(settled.currentDay).toBe('2026-09-25');
  });

  it('replaceDate runs AHEAD of pageDay (the runway settling on a scroll) and calls replaceUrl', () => {
    const replaceUrl = vi.fn();
    const settled = createSettledDay({
      pageDay: () => '2026-09-25',
      view: () => 'week',
      replaceUrl,
    });

    settled.replaceDate('2026-10-02');

    expect(settled.currentDay).toBe('2026-10-02');
    expect(replaceUrl).toHaveBeenCalledWith(
      new URLSearchParams({ view: 'week', date: '2026-10-02' }),
    );
  });

  it('falls through to pageDay() when nothing has settled yet, even if pageDay changes', () => {
    let pageDay = '2026-09-25';
    const settled = createSettledDay({
      pageDay: () => pageDay,
      view: () => 'week',
      replaceUrl: vi.fn(),
    });
    expect(settled.currentDay).toBe('2026-09-25');
    pageDay = '2026-11-01';
    expect(settled.currentDay).toBe('2026-11-01'); // `??` falls through — no settle to shadow it
  });
});
