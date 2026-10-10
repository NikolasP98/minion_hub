// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettledDay } from './settled-day.svelte';
import SettledDayHarness from './__fixtures__/SettledDayHarness.svelte';

vi.mock('$lib/analytics/track', () => ({ track: vi.fn() }));
import { track } from '$lib/analytics/track';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(track).mockClear();
});

async function mountSettledDay(pageDay = '2026-09-25', view = 'week') {
  let settled: SettledDay | undefined;
  let ownedEffects = 0;
  const replaceUrl = vi.fn();
  const mounted = render(SettledDayHarness, {
    props: {
      pageDay,
      view,
      replaceUrl,
      onReady: (value) => {
        settled = value;
      },
      onOwnedEffect: () => {
        ownedEffects += 1;
      },
    },
  });
  await tick();
  expect(ownedEffects, 'mounted settled-day owner effect did not execute').toBe(1);
  expect(settled, 'mounted owner did not expose settled-day state').toBeDefined();
  return { settled: settled!, replaceUrl, mounted };
}

describe('createSettledDay', () => {
  it('starts at pageDay() before any settle', async () => {
    const { settled } = await mountSettledDay();
    expect(settled.currentDay).toBe('2026-09-25');
  });

  it('replaceDate runs ahead of pageDay and calls replaceUrl', async () => {
    const { settled, replaceUrl } = await mountSettledDay();

    settled.replaceDate('2026-10-02');
    await tick();

    expect(settled.currentDay).toBe('2026-10-02');
    expect(replaceUrl).toHaveBeenCalledWith(
      new URLSearchParams({ view: 'week', date: '2026-10-02' }),
    );
  });

  it('re-seeds from pageDay when a real page load lands', async () => {
    const { settled, mounted } = await mountSettledDay();
    settled.replaceDate('2026-10-02');
    expect(settled.currentDay).toBe('2026-10-02');

    await mounted.rerender({ pageDay: '2026-11-01', view: 'week' });
    await tick();

    expect(settled.currentDay).toBe('2026-11-01');
  });
});

describe('createSettledDay URL write throttle', () => {
  it('no-ops a repeated settle on the same day (dedupe)', async () => {
    const { settled, replaceUrl } = await mountSettledDay();
    vi.useFakeTimers();

    settled.replaceDate('2026-10-02');
    settled.replaceDate('2026-10-02');
    vi.advanceTimersByTime(250);

    expect(replaceUrl).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });

  it('coalesces 20 rapid distinct settles into at most 2 writes, last day winning', async () => {
    const { settled, replaceUrl } = await mountSettledDay();
    vi.useFakeTimers();

    for (let i = 1; i <= 20; i++) {
      const day = `2026-10-${String(i).padStart(2, '0')}`;
      settled.replaceDate(day);
      // currentDay reflects the latest settle immediately, throttle or not.
      expect(settled.currentDay).toBe(day);
    }
    expect(replaceUrl.mock.calls.length).toBeLessThanOrEqual(2);
    expect(replaceUrl.mock.calls[0][0].get('date')).toBe('2026-10-01');

    vi.advanceTimersByTime(250);

    expect(replaceUrl).toHaveBeenCalledTimes(2);
    expect(replaceUrl.mock.calls[1][0].get('date')).toBe('2026-10-20');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('calendar_url_replace_coalesced', { dropped: 19 });
  });
});
