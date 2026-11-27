// @vitest-environment happy-dom
/** Spec 145 S4 — block status line, block accessible name and the range live region. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import BookingCalendar from './BookingCalendar.svelte';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  RESOURCES,
} from '../../../../tests/fixtures/mobile-composition/seed';

const byId = (id: string) => EVENTS.find((e) => e.id === id)!;
const SUBJECT = byId('r1-0'); // 45 min, "Paciente 1A", Consulta inicial

function mount(props: Record<string, unknown> = {}) {
  return render(BookingCalendar, {
    view: 'day',
    date: FIXTURE_DAY,
    timeZone: FIXTURE_TIME_ZONE,
    mutationScope: 'org-a',
    bookings: [SUBJECT],
    resources: RESOURCES,
    eventTypes: EVENT_TYPES,
    kinds: [],
    onview: vi.fn(),
    ondate: vi.fn(),
    onopen: vi.fn(),
    onmove: vi.fn(),
    ...props,
  } as never);
}
const blocks = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.evt[data-booking-id]')];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('block status line and name', () => {
  it('shows the status line on a tall block only', () => {
    const tall = mount({ pxPerHour: 120 }); // 45 min = 90 px
    expect(tall.container.querySelector('.evt .evt-status')?.textContent?.trim()).toBe('Confirmed');
    cleanup();
    const short = mount({ pxPerHour: 40, bookings: [{ ...SUBJECT, end: SUBJECT.start }] });
    expect(short.container.querySelector('.evt')).not.toBeNull();
    expect(short.container.querySelector('.evt .evt-status')).toBeNull();
  });

  it('adds the day, the full range and the status as hidden text, with no aria-label', () => {
    const { container } = mount();
    const b = blocks(container)[0];
    // No label override: the spoken name is the block's own text, so it contains the visible words.
    expect(b.getAttribute('aria-label')).toBeNull();
    const detail = b.querySelector('.sr-only')!.textContent!.trim();
    expect(detail).toMatch(/^Tuesday, September 8, \d\d:\d\d to \d\d:\d\d, Confirmed$/);
    expect(b.textContent).toContain('Consulta inicial');
    expect(b.textContent).toContain('Paciente 1A');
  });

  it('hides the visible status line from screen readers (the hidden text already says it)', () => {
    const { container } = mount({ pxPerHour: 120 });
    expect(container.querySelector('.evt .evt-status')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('range live region', () => {
  const touch = () => document.dispatchEvent(new Event('pointerdown'));
  // The calendar speaks through the shared announcer (spec 155), not a region of its own.
  const said = () => document.querySelector('[data-announcer="polite"]')?.textContent ?? '';
  const frame = () => vi.advanceTimersByTimeAsync(20); // the announcer sets its text on a frame
  afterEach(() => {
    for (const el of document.querySelectorAll('[data-announcer]')) el.textContent = '';
  });

  it('is empty on mount, then announces once, 300 ms after the last change', async () => {
    vi.useFakeTimers();
    const { container, rerender } = mount();
    expect(container.querySelector('[aria-live]')).toBeNull(); // no private live region
    await vi.advanceTimersByTimeAsync(400);
    touch();
    expect(said()).toBe('');
    await rerender({ view: 'week' });
    await vi.advanceTimersByTimeAsync(200);
    await rerender({ view: 'month' });
    await vi.advanceTimersByTimeAsync(299);
    expect(said()).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    await frame();
    expect(said()).toMatch(/^Month: .+, 1 appointment$/);
  });

  it('says nothing before the user touches the page', async () => {
    vi.useFakeTimers();
    const { rerender } = mount();
    await vi.advanceTimersByTimeAsync(400);
    await rerender({ view: 'month' });
    await vi.advanceTimersByTimeAsync(400);
    await frame();
    expect(said()).toBe('');
  });

  it('waits for the range to load, then counts what landed (cancelled excluded)', async () => {
    vi.useFakeTimers();
    const { rerender } = mount({ bookings: [] });
    await vi.advanceTimersByTimeAsync(400);
    touch();
    await rerender({ view: 'month', busy: true });
    await vi.advanceTimersByTimeAsync(1000);
    await frame();
    expect(said()).toBe('');
    await rerender({
      busy: false,
      bookings: [SUBJECT, { ...SUBJECT, id: 'x-cancelled', status: 'cancelled' }],
    });
    await vi.advanceTimersByTimeAsync(300);
    await tick();
    await frame();
    expect(said()).toMatch(/^Month: .+, 1 appointment$/);
  });
});
