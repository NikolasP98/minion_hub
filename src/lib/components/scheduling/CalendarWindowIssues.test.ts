// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import CalendarWindowIssues from './CalendarWindowIssues.svelte';
import type { CalendarWindowState } from './kit/window-cache.svelte';

afterEach(cleanup);

const cold: CalendarWindowState = {
  key: '2026-09-21',
  from: '2026-09-21',
  to: '2026-09-27',
  status: 'error',
  hasData: false,
};

describe('CalendarWindowIssues', () => {
  it('renders one truthful alert per failed week and retries the exact key', async () => {
    const onretry = vi.fn();
    const view = render(CalendarWindowIssues, {
      props: {
        windows: [
          cold,
          {
            key: '2026-09-28',
            from: '2026-09-28',
            to: '2026-10-04',
            status: 'error',
            hasData: true,
          },
        ],
        onretry,
      },
    });

    const alerts = view.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.textContent).toContain('Could not load events');
    expect(alerts[0]?.textContent).toContain('Sep 21, 2026');
    expect(alerts[0]?.textContent).toContain('Sep 27, 2026');
    expect(alerts[1]?.textContent).toContain('may be incomplete or out of date');

    await fireEvent.click(view.getByRole('button', { name: /Retry Sep 28, 2026.*Oct 4, 2026/ }));
    expect(onretry).toHaveBeenCalledWith('2026-09-28');
  });

  it('removes the alert when retry changes that window to loading', async () => {
    const view = render(CalendarWindowIssues, { props: { windows: [cold], onretry: vi.fn() } });
    expect(view.getAllByRole('alert')).toHaveLength(1);

    await view.rerender({ windows: [{ ...cold, status: 'loading' }], onretry: vi.fn() });
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('keeps date-only labels stable in a browser zone west of UTC', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const view = render(CalendarWindowIssues, { props: { windows: [cold], onretry: vi.fn() } });
      expect(view.getByRole('alert').textContent).toContain('Sep 21, 2026');
      expect(view.getByRole('alert').textContent).not.toContain('Sep 20, 2026');
    } finally {
      process.env.TZ = previous;
    }
  });
});
