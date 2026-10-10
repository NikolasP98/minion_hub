// @vitest-environment happy-dom
/**
 * The board and the table render ONE card/row per EVENT, not per service
 * (owner ask 2026-10-08: "events just become a single type"), and a write on a
 * multi-service event goes to the visit-wide verb while a single-service one
 * keeps today's per-row write.
 *
 * Both views feed the SAME `groupBookings` the grid uses, so the collapse rule
 * itself is covered by `booking-groups.test.ts`; what is proved here is the
 * wiring — row count, the joined title, the lead id a row opens with, and
 * which callback a status drag/edit lands on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import BookingBoard from './BookingBoard.svelte';
import BookingTable from './BookingTable.svelte';
import type { CalendarBooking } from './calendar-window';
import type { BookingCustomValues } from './kit/booking-custom-values.svelte';
import * as m from '$lib/paraglide/messages';

const TZ = 'UTC';
const RESOURCES = [
  { id: 'r1', name: 'Chair 1', color: null },
  { id: 'r2', name: 'Chair 2', color: null },
];
const EVENT_TYPES = [
  { id: 'e1', title: 'Cut' },
  { id: 'e2', title: 'Color' },
  { id: 'e3', title: 'Blowdry' },
];

const booking = (b: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
  resourceId: 'r1',
  eventTypeId: 'e1',
  start: '2026-10-08T10:00:00.000Z',
  end: '2026-10-08T11:00:00.000Z',
  status: 'accepted',
  attendeeName: 'Ana',
  ...b,
});

/** 3 service rows = 2 events: a 2-service visit, then a standalone booking. */
const BOOKINGS: CalendarBooking[] = [
  booking({ id: 'b1', eventTypeId: 'e1', groupId: 'g1', groupSeq: 0 }),
  booking({ id: 'b2', eventTypeId: 'e2', groupId: 'g1', groupSeq: 1 }),
  booking({
    id: 'b3',
    eventTypeId: 'e3',
    status: 'pending',
    attendeeName: 'Bruno',
    start: '2026-10-08T12:00:00.000Z',
    end: '2026-10-08T12:30:00.000Z',
  }),
];

/** No custom columns: this suite is about the box model, and the shared store
 *  has its own tests. */
const noCustomValues = () =>
  ({
    defs: [],
    selectDefs: [],
    canManage: false,
    failed: false,
    values: {},
    editable: {},
    managerActions: {},
    load: async () => {},
    setDefs: () => {},
    upsertDef: () => {},
    ensure: () => {},
    refetch: async () => {},
    valueOf: () => null,
    apply: async () => {},
    bundle: () => ({
      definitions: [],
      values: {},
      recordAccess: {},
      canManage: false,
      canEdit: false,
    }),
  }) as unknown as BookingCustomValues;

beforeEach(() => {
  // Nothing mounted here should reach the network; a call is a failure, not a
  // silent fallback.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BookingBoard', () => {
  const mount = (over: Record<string, unknown> = {}) => {
    const props = {
      bookings: BOOKINGS,
      resources: RESOURCES,
      eventTypes: EVENT_TYPES,
      timeZone: TZ,
      customValues: noCustomValues(),
      axis: 'status',
      onaxis: () => {},
      onopen: vi.fn(),
      onstatus: vi.fn(),
      onvisitstatus: vi.fn(),
      onstaff: vi.fn(),
      ...over,
    };
    const { container } = render(BookingBoard, { props });
    return { props, container };
  };

  /** The card carrying `title`'s service line — the columns are in status
   *  order, so a positional index would pick whichever status sorts first. */
  const cardOf = (title: string): HTMLElement => {
    const card = screen.getByText(title).closest('.bcard');
    if (!(card instanceof HTMLElement)) throw new Error(`no card for ${title}`);
    return card;
  };
  const visitCard = () => cardOf('Cut · Color');

  it('renders one card per event — 3 bookings, 2 sharing a groupId, 2 cards', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.bcard')).toHaveLength(2);
  });

  it('titles the visit card with its services joined, captioned by the count', () => {
    mount();
    expect(screen.getByText('Cut · Color')).toBeTruthy();
    expect(screen.getByText('2 services')).toBeTruthy();
    // The standalone booking keeps its own single title and gets no caption.
    expect(screen.getByText('Blowdry')).toBeTruthy();
    expect(screen.queryByText('1 services')).toBeNull();
  });

  it('opens the event on its LEAD service, whichever member was clicked', async () => {
    const { props } = mount();

    await fireEvent.click(visitCard());

    expect(props.onopen).toHaveBeenCalledWith('b1');
  });

  it('drags a multi-service event between status columns through the VISIT verb', async () => {
    const { props } = mount();

    await fireEvent.dragStart(visitCard());
    await fireEvent.drop(screen.getByLabelText('Completed'));

    expect(props.onvisitstatus).toHaveBeenCalledWith('b1', 'completed');
    expect(props.onstatus).not.toHaveBeenCalled();
  });

  it('keeps the single-service drag on the per-row verb', async () => {
    const { props } = mount();

    await fireEvent.dragStart(cardOf('Blowdry'));
    await fireEvent.drop(screen.getByLabelText('Completed'));

    expect(props.onstatus).toHaveBeenCalledWith('b3', 'completed');
    expect(props.onvisitstatus).not.toHaveBeenCalled();
  });
});

describe('BookingTable', () => {
  /**
   * happy-dom lays nothing out, so `DataTable`'s virtualised body renders no
   * `<tr>` (its viewport measures 0) — what IS observable is the table's own
   * row count over the data it was handed, which is the collapse itself: 3
   * service rows in, 2 EVENTS counted. The per-row wiring that shares its
   * shape with the board (open on the lead, visit-wide status) is asserted
   * above, where cards need no layout.
   */
  it('counts events, not services: 3 bookings with 2 sharing a groupId = 2 rows', () => {
    render(BookingTable, {
      props: {
        bookings: BOOKINGS,
        resources: RESOURCES,
        eventTypes: EVENT_TYPES,
        timeZone: TZ,
        customValues: noCustomValues(),
        scopeKey: 'test:scheduling.bookings',
        onopen: vi.fn(),
        canEdit: true,
        onstatus: vi.fn(),
        onvisitstatus: vi.fn(),
        onstaff: vi.fn(),
      },
    });

    expect(screen.getByText(m.data_table_rows({ total: 2 }))).toBeTruthy();
  });
});
