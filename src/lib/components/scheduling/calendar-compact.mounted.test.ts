// @vitest-environment happy-dom
/**
 * Spec 145 S1 — the compact (phone) toolbar of `BookingCalendar`, mounted on the
 * component itself. happy-dom lays nothing out: geometry is asserted in Chromium
 * by `tests/e2e/ui-audit/calendar-mobile.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import BookingCalendar from './BookingCalendar.svelte';

const TZ = 'America/Lima';
const DAY = '2026-09-09'; // a Wednesday

function mount(props: Record<string, unknown> = {}) {
  const onview = vi.fn();
  const ondate = vi.fn();
  const view = render(BookingCalendar, {
    view: 'day',
    date: DAY,
    timeZone: TZ,
    mutationScope: 'org-a',
    bookings: [],
    resources: [{ id: 'r1', name: 'Leiva', color: '#4f8ff7' }],
    eventTypes: [],
    kinds: [],
    onview,
    ondate,
    ...props,
  } as never);
  return { ...view, onview, ondate };
}

const name = (el: Element) =>
  (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('compact toolbar', () => {
  it('has the date, view and "…" buttons, and none of the desktop controls', () => {
    const { container } = mount({ compact: true });
    const toolbar = container.querySelector('.cal-toolbar')!;
    expect(toolbar.classList.contains('is-compact')).toBe(true);
    const names = [...toolbar.querySelectorAll('button')].map(name);
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/Sep/);
    expect(names[1]).toBe('Day');
    expect(names[2]).toBe('Calendar options');
    expect(toolbar.querySelector('[role="radiogroup"], .seg')).toBeNull();
    for (const gone of ['Previous', 'Next', 'Today']) {
      expect([...toolbar.querySelectorAll('button')].map(name)).not.toContain(gone);
    }
  });

  it('shows the host badge count and the attention dot on "…"', () => {
    const { container } = mount({ compact: true, kebabBadge: 4, kebabAttention: true });
    const more = container.querySelector<HTMLElement>(
      '.cal-toolbar button[aria-label^="Calendar options"]',
    )!;
    expect(more.textContent).toContain('4');
    // The label replaces the content for screen readers, so it must carry both.
    expect(more.getAttribute('aria-label')).toBe('Calendar options, 4, Needs attention');
    expect(more.querySelector('.cc-dot')).not.toBeNull();
    const none = mount({ compact: true });
    expect(none.container.querySelector('.cc-dot')).toBeNull();
  });

  it('lists the views as radios, marks the active one and calls onview', async () => {
    const { container, onview, getByText } = mount({
      compact: true,
      features: { agenda: true },
      weekDays: 3,
    });
    await fireEvent.click(getByText('Day', { selector: '.cal-toolbar span' }));
    await tick();
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map(name)).toEqual(['Day', '3 days', 'Month', 'List']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    await fireEvent.click(radios[1]);
    expect(onview).toHaveBeenCalledWith('week');
    expect(container).toBeTruthy();
  });
});

describe('week strip', () => {
  it('renders seven days, marks the selected one and names today', () => {
    // 2026-09-09 is "today" only when the clock says so.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T17:00:00.000Z')); // Thu 12:00 Lima
    try {
      const { container } = mount({ compact: true });
      const days = [...container.querySelectorAll<HTMLElement>('.ws-day')];
      expect(days).toHaveLength(7);
      const current = days.filter((d) => d.getAttribute('aria-current') === 'date');
      expect(current).toHaveLength(1);
      expect(name(current[0])).toContain('9');
      const todays = days.filter((d) => /, today$/.test(name(d)));
      expect(todays).toHaveLength(1);
      expect(name(todays[0])).toContain('10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is absent without compact', () => {
    const { container } = mount();
    expect(container.querySelector('.ws-day')).toBeNull();
  });

  it('a day tap in day view navigates through ondate', async () => {
    const { container, ondate } = mount({ compact: true });
    const days = [...container.querySelectorAll<HTMLElement>('.ws-day')];
    await fireEvent.click(days[0]);
    expect(ondate).toHaveBeenCalledWith('2026-09-07');
  });
});

describe('desktop toolbar is unchanged', () => {
  it('keeps prev / next / today and the view switcher', () => {
    const { container } = mount();
    const toolbar = container.querySelector('.cal-toolbar')!;
    expect(toolbar.classList.contains('is-compact')).toBe(false);
    const names = [...toolbar.querySelectorAll('button')].map(name);
    for (const n of ['Day', 'Week', 'Month', 'Previous', 'Next', 'Today', 'Calendar options']) {
      expect(names).toContain(n);
    }
  });
});
