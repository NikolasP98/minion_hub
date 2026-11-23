// @vitest-environment happy-dom
/**
 * Spec 145 S3 — Lista and Mes on phones (`compact`). happy-dom lays nothing out:
 * row heights and the month's snapping are verified in Chromium.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import BookingCalendar from './BookingCalendar.svelte';
import type { CalendarBooking } from './calendar-window';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  RESOURCES,
  VISIT_LEAD_ID,
  VISIT_MEMBER_ID,
} from '../../../../tests/fixtures/mobile-composition/seed';

const byId = (id: string) => EVENTS.find((e) => e.id === id)!;
const SUBJECT = byId('r1-0');
const LEAD = byId(VISIT_LEAD_ID);
const MEMBER = byId(VISIT_MEMBER_ID);

function mount(props: Record<string, unknown> = {}) {
  const onview = vi.fn();
  const view = render(BookingCalendar, {
    view: 'agenda',
    date: FIXTURE_DAY,
    timeZone: FIXTURE_TIME_ZONE,
    mutationScope: 'org-a',
    bookings: [SUBJECT],
    resources: RESOURCES,
    eventTypes: EVENT_TYPES,
    kinds: [],
    onview,
    ondate: vi.fn(),
    onopen: vi.fn(),
    onmove: vi.fn(),
    features: { agenda: true },
    ...props,
  } as never);
  return { ...view, onview };
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

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

describe('compact list', () => {
  it('has one group per visible day, with a "No appointments" row on an empty day', () => {
    const { container } = mount({ compact: true });
    const heads = container.querySelectorAll('.ag-day');
    expect(heads.length).toBeGreaterThan(1);
    const empties = container.querySelectorAll('.ag-empty');
    expect(empties.length).toBe(heads.length - 1);
    expect(text(empties[0])).toBe('No appointments');
    expect(empties[0].closest('button')).toBeNull();
    expect(container.querySelectorAll('.ag-row')).toHaveLength(1);
  });

  it('a row shows the client, the staff member and the status name', () => {
    const { container } = mount({ compact: true });
    const row = container.querySelector('.ag-row')!;
    expect(text(row)).toContain('Paciente 1A');
    expect(text(row)).toContain('Leiva');
    expect(text(row)).toContain('Confirmed');
    expect(text(row)).not.toContain('undefined');
  });

  it('omits a missing client cleanly', () => {
    const { container } = mount({
      compact: true,
      bookings: [{ ...SUBJECT, attendeeName: null } as CalendarBooking],
    });
    const sub = text(container.querySelector('.ag-sub'));
    expect(sub).toBe('Leiva');
  });

  it("a merged visit shows the lead's client and the status of the active member", () => {
    const { container } = mount({
      compact: true,
      bookings: [
        { ...LEAD, status: 'cancelled' },
        { ...MEMBER, status: 'pending' },
      ],
    });
    const rows = container.querySelectorAll('.ag-row');
    expect(rows).toHaveLength(1);
    expect(text(rows[0])).toContain('Paciente Visita');
    expect(text(rows[0])).toContain('Pending');
  });

  it('non-compact omits empty days and keeps the whole-range empty state', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.ag-day')).toHaveLength(1);
    expect(container.querySelector('.ag-empty')).toBeNull();
    expect(container.querySelector('.ag-sub')).toBeNull();
    const none = mount({ bookings: [] });
    expect(none.container.textContent).toContain('Nothing scheduled in this range.');
  });
});

describe('compact month', () => {
  const day = (c: HTMLElement) => [...c.querySelectorAll('.m-cell')];
  const cellOf = (c: HTMLElement, d: number) =>
    day(c).find((el) => text(el.querySelector('.m-day-num, .m-num')) === String(d))!;
  const month = (extra: Record<string, unknown> = {}) =>
    mount({
      view: 'month',
      compact: true,
      bookings: [
        SUBJECT,
        byId('r2-0'),
        { ...byId('r3-0'), status: 'cancelled' },
        { ...byId('r4-0'), status: 'no_show' },
      ],
      ...extra,
    });

  it('renders no chips or "+N", and the count excludes inactive bookings', () => {
    const { container } = month();
    expect(container.querySelector('.m-chip')).toBeNull();
    expect(container.querySelector('.m-more')).toBeNull();
    expect(container.querySelector('.m-inv')).toBeNull();
    const cell = cellOf(container, 8);
    expect(text(cell.querySelector('.m-count'))).toBe('2');
    expect(text(cell.querySelector('.m-day .sr-only'))).toBe(
      'Tuesday, September 8, 2 appointments',
    );
  });

  it('shows no count on an empty day', () => {
    const { container } = month();
    expect(cellOf(container, 9).querySelector('.m-count')).toBeNull();
  });

  it('clicking the cell opens that day', async () => {
    const { container, onview } = month();
    await fireEvent.click(cellOf(container, 8).querySelector('.m-day')!);
    expect(onview).toHaveBeenCalledWith('day', FIXTURE_DAY);
  });

  it('non-compact month still renders chips', () => {
    const { container } = month({ compact: false });
    expect(container.querySelector('.m-chip')).not.toBeNull();
    expect(container.querySelector('.m-day')).toBeNull();
  });
});
