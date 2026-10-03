// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import DateRangeControls from './DateRangeControls.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DateRangeControls clock and timezone policy', () => {
  it('resolves a click with the current clock after the mounted tab crosses midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T01:30:00.000Z'));
    const onChange = vi.fn();
    const view = render(DateRangeControls, {
      props: {
        from: '',
        to: '',
        periods: [],
        timeZone: 'America/Lima',
        onChange,
      },
    });

    // Mount: Oct 2 in Lima. Advance one day without changing any prop: Oct 3.
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    await fireEvent.click(view.getByRole('button', { name: '1d' }));

    expect(onChange).toHaveBeenLastCalledWith({
      from: '2026-10-03',
      to: '2026-10-03',
      period: 'day',
    });
  });

  it('cleans up its minute clock when destroyed', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const view = render(DateRangeControls, {
      props: {
        from: '',
        to: '',
        periods: [],
        timeZone: 'UTC',
        onChange: vi.fn(),
      },
    });

    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('recomputes active preset matching as the minute clock advances', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T01:30:00.000Z'));
    const view = render(DateRangeControls, {
      props: {
        from: '2026-10-02',
        to: '2026-10-02',
        periods: [],
        timeZone: 'America/Lima',
        onChange: vi.fn(),
      },
    });
    const oneDay = view.getByRole('button', { name: '1d' });
    expect(oneDay.getAttribute('aria-pressed')).toBe('true');

    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(oneDay.getAttribute('aria-pressed')).toBe('false');
  });
});
