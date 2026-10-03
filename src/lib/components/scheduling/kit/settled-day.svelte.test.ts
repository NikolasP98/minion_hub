// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettledDay } from './settled-day.svelte';
import SettledDayHarness from './__fixtures__/SettledDayHarness.svelte';

afterEach(() => cleanup());

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
