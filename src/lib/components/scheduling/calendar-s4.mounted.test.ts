// @vitest-environment happy-dom
/**
 * Calendar cluster slice S4 (HC-016, HC-021, HC-022, HC-023) — the parts
 * happy-dom can see. happy-dom lays nothing out (no `clientWidth`, no
 * `getBoundingClientRect`), so the week runway stays UNMEASURED here: the
 * rendered columns are the pre-measurement window around `anchorIndex`, which
 * is exactly what HC-016A's arithmetic decides. Geometry (containment boxes,
 * scroll offsets, tooltip visibility on tap/Tab) is proven in real Chromium by
 * `tests/e2e/ui-audit/calendar-cluster-s4.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import BookingCalendar from './BookingCalendar.svelte';
import type { CalendarBooking, CalendarInvoice } from './calendar-window';

const TZ = 'America/Lima';
const DAY = '2026-09-08'; // a Tuesday; its Monday is 09-07
const RESOURCES = [
  { id: 'r1', name: 'Leiva', color: '#4f8ff7' },
  { id: 'r2', name: 'Nikolas Sebastian Pinon Sarria', color: '#c14ff7' },
];
const EVENT_TYPES = [
  {
    id: 'et0',
    title: 'Consulta inicial',
    productId: null,
    active: true,
    length: 45,
    resourceIds: ['r1', 'r2'],
    color: null,
    kindId: null,
  },
];
const at = (day: string, hh: number, mm = 0) =>
  new Date(
    `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-05:00`,
  ).toISOString();
function booking(
  id: string,
  resourceId: string,
  start: string,
  end: string,
  extra: Partial<CalendarBooking> = {},
): CalendarBooking {
  return {
    id,
    resourceId,
    eventTypeId: 'et0',
    start,
    end,
    status: 'accepted',
    attendeeName: `Client ${id}`,
    attendeePhone: null,
    notes: null,
    productId: null,
    partyId: null,
    groupId: null,
    groupSeq: null,
    groupLength: null,
    checkup: false,
    tags: [],
    kindId: null,
    categoryColor: null,
    ...extra,
  };
}
const VISIT = [
  booking('v-lead', 'r2', at(DAY, 15, 30), at(DAY, 16, 30), {
    groupId: 'g1',
    groupSeq: 0,
    groupLength: 30,
  }),
  booking('v-member', 'r2', at(DAY, 15, 30), at(DAY, 16, 30), {
    groupId: 'g1',
    groupSeq: 1,
    groupLength: 30,
  }),
];

type Props = ComponentProps<typeof BookingCalendar>;
function props(over: Partial<Props> = {}): Props {
  return {
    view: 'week',
    date: DAY,
    timeZone: TZ,
    mutationScope: 'test',
    bookings: [],
    resources: RESOURCES,
    eventTypes: EVENT_TYPES,
    onview: vi.fn(),
    ondate: vi.fn(),
    onopen: vi.fn(),
    ...over,
  } as Props;
}
const headNames = (root: Element) =>
  [...root.querySelectorAll('.col-head .head-name')].map((el) => el.textContent?.trim());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HC-016A — runway anchor', () => {
  it('opens on the Monday of `date` without an anchor', () => {
    const view = render(BookingCalendar, { props: props() });
    // Week view, unmeasured: the window starts at `anchorIndex`.
    expect(headNames(view.container)[0]).toBe('Mon');
  });

  it('opens on the saved first visible day when an anchor is given', () => {
    const view = render(BookingCalendar, {
      props: props({ anchor: { firstDay: '2026-09-09', scrollTop: 300 } }),
    });
    expect(headNames(view.container)[0]).toBe('Wed');
    // `onrange` reports the same window the anchor chose.
  });

  it('ignores an anchor that is off the runway', () => {
    const view = render(BookingCalendar, {
      props: props({ anchor: { firstDay: '2031-01-01', scrollTop: 0 } }),
    });
    expect(headNames(view.container)[0]).toBe('Mon');
  });

  it('reports no anchor while the runway was never measured (nothing to restore)', () => {
    const onanchor = vi.fn();
    const view = render(BookingCalendar, { props: props({ onanchor }) });
    view.unmount();
    expect(onanchor).not.toHaveBeenCalled();
  });
});

describe('HC-016C — fan contract', () => {
  // `fanOut` defaults OFF since master retired the deck (owner 2026-10-07,
  // calendar-features.ts); the code path still exists for in-flight callers,
  // so this test opts in explicitly to prove the open/close effect still
  // behaves once a caller asks for it.
  const fanProps = (over: Partial<Props> = {}) => props({ features: { fanOut: true }, ...over });

  it('closes the fan on a view change and on a date change', async () => {
    const view = render(BookingCalendar, { props: fanProps({ view: 'day', bookings: VISIT }) });
    const box = view.container.querySelector('.col:not(.is-all) .evt.is-visit') as HTMLElement;
    expect(box).not.toBeNull();
    await fireEvent.click(box);
    expect(view.container.querySelector('.fan-deck')).not.toBeNull();

    await view.rerender({ props: fanProps({ view: 'week', bookings: VISIT }) });
    expect(view.container.querySelector('.fan-deck')).toBeNull();

    const again = view.container.querySelector('.evt.is-visit') as HTMLElement;
    await fireEvent.click(again);
    expect(view.container.querySelector('.fan-deck')).not.toBeNull();
    await view.rerender({ props: fanProps({ view: 'week', date: '2026-09-15', bookings: VISIT }) });
    expect(view.container.querySelector('.fan-deck')).toBeNull();
  });
});

describe('HC-022B — containment markers', () => {
  const EARLY = booking('early', 'r1', at(DAY, 6, 30), at(DAY, 7, 30));
  const LATE = booking('late', 'r1', at(DAY, 21, 30), at(DAY, 22, 30));
  const GONE = booking('gone', 'r1', at(DAY, 5, 0), at(DAY, 6, 0));

  it('pins a before-hours box to the top edge and names where it starts', () => {
    const view = render(BookingCalendar, {
      props: props({ view: 'day', bookings: [EARLY, LATE, GONE] }),
    });
    const evts = [...view.container.querySelectorAll<HTMLElement>('.col:not(.is-all) .evt')];
    const early = evts.find((e) => e.textContent?.includes('Client early'))!;
    expect(early.style.top).toBe('0px');
    expect(early.classList.contains('is-clipped-top')).toBe(true);
    const descr = early.getAttribute('aria-describedby')!;
    expect(document.getElementById(descr)?.textContent).toBe('Starts 06:30');
    // Only the 07:00–07:30 half is visible: 28px at 56px/h.
    expect(parseFloat(early.style.height)).toBe(28);
  });

  it('cuts an after-hours box at the floor and names where it ends', () => {
    const view = render(BookingCalendar, {
      props: props({ view: 'day', bookings: [EARLY, LATE, GONE] }),
    });
    const evts = [...view.container.querySelectorAll<HTMLElement>('.col:not(.is-all) .evt')];
    const late = evts.find((e) => e.textContent?.includes('Client late'))!;
    expect(late.classList.contains('is-clipped-bottom')).toBe(true);
    expect(parseFloat(late.style.top) + parseFloat(late.style.height)).toBe(15 * 56);
    expect(document.getElementById(late.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Ends 22:30',
    );
  });

  it('does not paint a box that lies entirely outside the track', () => {
    const view = render(BookingCalendar, {
      props: props({ view: 'day', bookings: [EARLY, LATE, GONE] }),
    });
    expect(view.container.textContent).not.toContain('Client gone');
  });

  it('keeps committed boxes in the clip and the overlays beside it', () => {
    const view = render(BookingCalendar, { props: props({ view: 'day', bookings: [EARLY] }) });
    const track = view.container.querySelector('.col:not(.is-all) .track')!;
    expect(track.querySelector(':scope > .track-clip .evt')).not.toBeNull();
    expect(track.querySelector(':scope > .track-overlay')).not.toBeNull();
    expect(track.querySelector(':scope > .evt')).toBeNull();
  });
});

describe('HC-023A — header labels', () => {
  it('column heads carry the full name, are focusable and have no native title', () => {
    const view = render(BookingCalendar, { props: props({ view: 'day' }) });
    const heads = [...view.container.querySelectorAll<HTMLElement>('.col-head')];
    expect(heads.length).toBe(RESOURCES.length + 1);
    for (const head of heads) expect(head.getAttribute('title')).toBeNull();
    const name = view.container.querySelector<HTMLElement>(
      '.col:not(.is-all):nth-child(3) .head-name',
    )!;
    expect(name.textContent?.trim()).toBe('Nikolas Sebastian Pinon Sarria');
    expect(name.tabIndex).toBe(0);
    expect(name.getAttribute('title')).toBeNull();
  });

  it('lane heads (subcolumns) follow the same contract', () => {
    const view = render(BookingCalendar, {
      props: props({
        view: 'day',
        subBy: 'status',
        onsubby: vi.fn(),
        bookings: [...VISIT, booking('p', 'r1', at(DAY, 9), at(DAY, 10), { status: 'pending' })],
      }),
    });
    const lanes = [...view.container.querySelectorAll<HTMLElement>('.head-sub-cell')];
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(lane.tabIndex).toBe(0);
      expect(lane.getAttribute('title')).toBeNull();
      expect(lane.textContent?.trim()).not.toBe('');
    }
  });
});

describe('HC-021 — month contract', () => {
  const INVOICE: CalendarInvoice = {
    id: 'inv1',
    humanId: 'B001-1',
    at: at(DAY, 11, 0),
    total: 50,
    currency: 'PEN',
    customerName: 'Pagó',
    lines: [{ id: 'l1', description: 'Consulta', bookingId: null }],
  };
  const visitChip = (root: Element) => root.querySelector<HTMLElement>('.m-chip.is-visit')!;

  it('a visit chip carries a member badge and is a hover-card trigger', () => {
    const view = render(BookingCalendar, { props: props({ view: 'month', bookings: VISIT }) });
    const chip = visitChip(view.container);
    expect(chip.classList.contains('is-visit')).toBe(true);
    // The chip IS the Tooltip trigger (Zag owns it by the machine id).
    expect(chip.getAttribute('data-ownedby')).toBe(`mchip-${DAY}-v-lead`);
    expect(chip.querySelector('.m-chip-c')?.textContent).toBe('×2');
    const descr = chip.getAttribute('aria-describedby')!;
    expect(document.getElementById(descr)?.textContent).toBe('2 services');
  });

  // The hover card itself (visit card + the one "Open day" action) opens through
  // Zag's pointer/focus intent, which happy-dom does not drive — proven in
  // Chromium by calendar-cluster-s4.spec.ts.

  it('with the split on, a day with tickets shows an "N invoiced" chip that opens the day', async () => {
    const onview = vi.fn();
    const view = render(BookingCalendar, {
      props: props({ view: 'month', bookings: VISIT, invoices: [INVOICE], split: true, onview }),
    });
    const chip = view.container.querySelector<HTMLElement>('.m-inv')!;
    expect(chip.textContent).toContain('1 invoiced');
    await fireEvent.click(chip);
    expect(onview).toHaveBeenCalledWith('day', DAY);
  });

  it('a drag attempt on a chip shows the refusal hint, commits nothing, and the hint opens the day', async () => {
    const onview = vi.fn();
    const onmove = vi.fn();
    const view = render(BookingCalendar, {
      props: props({ view: 'month', bookings: VISIT, onview, onmove }),
    });
    const chip = visitChip(view.container);
    await fireEvent.pointerDown(chip, { button: 0, clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(chip, { clientX: 10, clientY: 30 });
    const hint = view.container.querySelector<HTMLElement>('.m-hint')!;
    expect(hint).not.toBeNull();
    expect(hint.textContent?.trim()).toBe('Open the day to move');
    expect(onmove).not.toHaveBeenCalled();
    await fireEvent.click(hint);
    expect(onview).toHaveBeenCalledWith('day', DAY);
  });

  it('an external draggable over a cell sets the same hint', async () => {
    const view = render(BookingCalendar, {
      props: props({ view: 'month', bookings: VISIT, ondropexternal: vi.fn() }),
    });
    const chip = visitChip(view.container);
    const cell = chip.closest('.m-cell')!;
    await fireEvent.dragOver(cell, {
      dataTransfer: { types: ['application/x-minion-calendar-drop'], dropEffect: 'copy' },
    });
    expect(cell.querySelector('.m-hint')).not.toBeNull();
  });
});
