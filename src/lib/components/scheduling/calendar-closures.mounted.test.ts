// @vitest-environment happy-dom
/**
 * Spec 147 — agenda closures on the calendar: a hatched band with its reason in
 * the day/week grid, a row in the list, a reopen dialog (one day or the group),
 * and the band hides while the reopen is in flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import BookingCalendar from './BookingCalendar.svelte';
import type { CalendarClosure } from './calendar-window';
import {
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  RESOURCES,
} from '../../../../tests/fixtures/mobile-composition/seed';
import { startOfZonedDate } from '$lib/time/zoned';

const dayStart = startOfZonedDate(FIXTURE_DAY, FIXTURE_TIME_ZONE);
if (!dayStart.ok) throw new Error('fixture day');
const at = (h: number) => new Date(dayStart.instant.getTime() + h * 3_600_000).toISOString();
const CLOSURE: CalendarClosure = {
  id: 'c1',
  groupId: 'g1',
  groupSize: 3,
  start: at(9),
  end: at(14),
  reason: 'Viaje del doctor',
};

function mount(props: Record<string, unknown> = {}) {
  return render(BookingCalendar, {
    view: 'day',
    date: FIXTURE_DAY,
    timeZone: FIXTURE_TIME_ZONE,
    mutationScope: 'org-a',
    bookings: [],
    resources: RESOURCES,
    eventTypes: EVENT_TYPES,
    kinds: [],
    onview: vi.fn(),
    ondate: vi.fn(),
    onopen: vi.fn(),
    features: { agenda: true },
    closures: [CLOSURE],
    ...props,
  } as never);
}

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

describe('agenda closures', () => {
  it('draws a band over the closed hours whose label names the time and the reason', () => {
    const { container } = mount();
    const band = container.querySelector('.closure') as HTMLElement;
    expect(band).not.toBeNull();
    // 09:00 on a 07:00 grid at 56 px/h → 112 px down, 5 h tall.
    expect(band.style.top).toBe('112px');
    expect(band.style.height).toBe('280px');
    const label = screen.getAllByRole('button', { name: /09:00 – 14:00.*Viaje del doctor/ });
    expect(label.length).toBeGreaterThan(0);
  });

  it('reopening the whole group calls onreopen with group=true and hides the band meanwhile', async () => {
    let settle!: (ok: boolean) => void;
    const onreopen = vi.fn(() => new Promise<boolean>((r) => (settle = r)));
    const { container } = mount({ onreopen });
    await fireEvent.click(screen.getAllByRole('button', { name: /Viaje del doctor/ })[0]);
    await fireEvent.click(await screen.findByRole('button', { name: /\(3/ }));
    expect(onreopen).toHaveBeenCalledWith(CLOSURE, { group: true });
    await vi.waitFor(() => expect(container.querySelector('.closure')).toBeNull());
    settle(false); // refused → the band comes back
    await vi.waitFor(() => expect(container.querySelector('.closure')).not.toBeNull());
  });

  it('read-only without onreopen: the dialog offers no reopen action', async () => {
    mount();
    await fireEvent.click(screen.getAllByRole('button', { name: /Viaje del doctor/ })[0]);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /\(3/ })).toBeNull();
  });

  it('the list view shows the closed day as a row', () => {
    const { container } = mount({ view: 'agenda' });
    const row = container.querySelector('.ag-closed');
    expect(row?.textContent).toContain('Viaje del doctor');
  });
});
