// @vitest-environment happy-dom
/**
 * S3 — stable facet registry + category (HC-017, HC-018, HC-020), mounted on
 * the real `BookingCalendar` in week view with subcolumns on.
 *
 * happy-dom lays nothing out, so only the lane LIST (order, labels, which box
 * sits in which lane index, how many boxes a booking renders as) is proven
 * here; lane pixel widths across a facet-adding scroll are asserted in real
 * Chromium by `tests/e2e/ui-audit/calendar-lanes.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import BookingCalendar from './BookingCalendar.svelte';
import type { CalendarBooking } from './calendar-window';

const TZ = 'America/Lima';
const DAY = '2026-09-08';

const RESOURCES = [{ id: 'r1', name: 'Leiva', color: '#4f8ff7' }];
const EVENT_TYPES = [
  { id: 'et0', title: 'Consulta', productId: null, active: true, length: 45, color: null },
];

function booking(id: string, day: string, hh: number, patch: Partial<CalendarBooking> = {}) {
  const start = `${day}T${String(hh + 5).padStart(2, '0')}:00:00.000Z`; // Lima = UTC-5
  const end = `${day}T${String(hh + 5).padStart(2, '0')}:45:00.000Z`;
  return {
    id,
    resourceId: 'r1',
    eventTypeId: 'et0',
    start,
    end,
    status: 'accepted',
    attendeeName: id,
    tags: [],
    categoryColor: null,
    ...patch,
  } satisfies CalendarBooking;
}

function mount(props: Record<string, unknown>) {
  const onopen = vi.fn();
  const view = render(BookingCalendar, {
    view: 'week',
    date: DAY,
    timeZone: TZ,
    mutationScope: 'org-a',
    resources: RESOURCES,
    eventTypes: EVENT_TYPES,
    kinds: [],
    onview: () => {},
    ondate: () => {},
    onopen,
    onsubby: () => {},
    ...props,
  } as never);
  return { ...view, onopen };
}

/** Lane labels of the first rendered column (every column shares the list). */
function laneLabels(container: HTMLElement): string[] {
  const head = container.querySelector('.head-subs');
  return [...(head?.querySelectorAll('.head-sub-cell') ?? [])].map((el) =>
    (el.textContent ?? '').trim(),
  );
}

beforeEach(() => {
  // The grid's private custom-column store loads its definitions; nothing else
  // may leave the test (no dev server here).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The lane index a box is placed in (`data-sub`; happy-dom drops the
 *  `calc()` inline `left`, so the index is read off the attribute). */
function laneOf(container: HTMLElement, id: string): number {
  const el = container.querySelector<HTMLElement>(`.evt[data-booking-id="${id}"]`);
  return Number(el?.dataset.sub);
}

describe('HC-018 — the lane list is append-only within a mounted session', () => {
  it('appends a lane first seen in a later week after the existing ones, and never drops one', async () => {
    const weekA = [
      booking('a1', '2026-09-08', 9),
      booking('a2', '2026-09-09', 10, { status: 'completed' }),
    ];
    const view = mount({ subBy: 'status', bookings: weekA });
    expect(laneLabels(view.container)).toEqual(['Confirmed', 'Completed']);

    // Week B arrives with `pending`, which the registry ranks BETWEEN the two
    // lanes already on screen — a re-sort would put it in the middle.
    await view.rerender({
      bookings: [...weekA, booking('b1', '2026-09-15', 9, { status: 'pending' })],
    } as never);
    await tick();
    expect(laneLabels(view.container)).toEqual(['Confirmed', 'Completed', 'Pending']);

    // Week A scrolls out of the cache: the window now holds ONE distinct value,
    // yet the lanes the operator already saw stay put.
    await view.rerender({
      bookings: [booking('b1', '2026-09-15', 9, { status: 'pending' })],
    } as never);
    await tick();
    expect(laneLabels(view.container)).toEqual(['Confirmed', 'Completed', 'Pending']);
  });

  it('resets the session when the axis changes', async () => {
    const list = [
      booking('a1', '2026-09-08', 9),
      booking('a2', '2026-09-09', 10, { status: 'completed' }),
    ];
    const view = mount({ subBy: 'status', bookings: list });
    expect(laneLabels(view.container)).toEqual(['Confirmed', 'Completed']);
    await view.rerender({ subBy: 'staff' } as never);
    await tick();
    // One staff member = nothing to classify: a single unlabelled column.
    expect(laneLabels(view.container)).toEqual([]);
  });
});

describe('HC-017 — a multi-tag booking is projected into every tag lane as ONE record', () => {
  const laser = { id: 't-laser', name: 'Laser', color: '#aa0000', origin: 'own' as const };
  const vip = { id: 't-vip', name: 'VIP', color: '#ec4899', origin: 'contact' as const };
  const tagOptions = [
    { id: 't-vip', name: 'VIP', color: '#ec4899' },
    { id: 't-laser', name: 'Laser', color: '#aa0000' },
  ];

  it.each([
    ['own → contact', [laser, vip]],
    ['contact → own', [vip, laser]],
  ])('renders two boxes with one identity for server order %s', async (_label, tags) => {
    const view = mount({
      subBy: 'tags',
      tagOptions,
      bookings: [
        booking('two', '2026-09-08', 9, { tags }),
        booking('one', '2026-09-09', 10, { tags: [vip] }),
      ],
    });
    // Lane labels come from the registry, in registry order (HC-017C).
    expect(laneLabels(view.container)).toEqual(['VIP', 'Laser']);
    const copies = view.container.querySelectorAll<HTMLElement>('.evt[data-booking-id="two"]');
    expect(copies).toHaveLength(2);
    // Two different lanes, one booking.
    expect([...copies].map((el) => Number(el.dataset.sub)).sort()).toEqual([0, 1]);
    expect(view.container.querySelectorAll('.evt[data-booking-id="one"]')).toHaveLength(1);

    // Clicking EITHER projection opens the one booking once.
    await fireEvent.click(copies[1]);
    expect(view.onopen).toHaveBeenCalledTimes(1);
    expect(view.onopen).toHaveBeenCalledWith('two');
  });
});

describe('HC-020 — category is a subcolumn axis with named lanes', () => {
  it('names lanes from the categories registry in registry order, unclassified last', () => {
    const view = mount({
      subBy: 'category',
      categories: [
        { name: 'Laser', color: '#aa0000' },
        { name: 'Facial', color: '#00aa00' },
      ],
      bookings: [
        booking('f', '2026-09-08', 9, { category: 'Facial', categoryColor: '#00aa00' }),
        booking('l', '2026-09-08', 11, { category: 'Laser', categoryColor: '#aa0000' }),
        booking('u', '2026-09-09', 9, { category: null }),
      ],
    });
    expect(laneLabels(view.container)).toEqual(['Laser', 'Facial', 'Unclassified']);
    expect(laneOf(view.container, 'l')).toBe(0);
    expect(laneOf(view.container, 'f')).toBe(1);
    expect(laneOf(view.container, 'u')).toBe(2);
  });

  it('offers category in the subcolumn picker', async () => {
    const view = mount({
      subBy: 'none',
      categories: [{ name: 'Laser', color: '#aa0000' }],
      bookings: [booking('a', '2026-09-08', 9)],
    });
    const buttonByText = (re: RegExp) =>
      [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
        re.test(b.textContent ?? ''),
      );
    const kebab = buttonByText(/Calendar options/);
    expect(kebab).toBeDefined();
    await fireEvent.click(kebab!);
    await tick();
    const row = buttonByText(/Subcolumns/);
    expect(row).toBeDefined();
    await fireEvent.click(row!);
    await tick();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((el) =>
      (el.textContent ?? '').trim(),
    );
    expect(options.some((t) => /^Category/.test(t))).toBe(true);
  });
});

describe('a multi-service visit projects into every lane its MEMBERS belong to', () => {
  const laser = { id: 't-laser', name: 'Laser', color: '#aa0000', origin: 'own' as const };
  const vip = { id: 't-vip', name: 'VIP', color: '#ec4899', origin: 'contact' as const };
  const tagOptions = [
    { id: 't-vip', name: 'VIP', color: '#ec4899' },
    { id: 't-laser', name: 'Laser', color: '#aa0000' },
  ];

  it('HC-017: unions tags across box.members, not just the lead (one id, two lane copies)', () => {
    const view = mount({
      subBy: 'tags',
      tagOptions,
      bookings: [
        // Lead carries VIP only; its second service carries Laser only — the
        // box as a whole must still reach both lanes.
        booking('visit', '2026-09-08', 9, {
          tags: [vip],
          groupId: 'g1',
          groupSeq: 0,
        }),
        booking('visit-svc2', '2026-09-08', 9, {
          tags: [laser],
          groupId: 'g1',
          groupSeq: 1,
        }),
      ],
    });
    expect(laneLabels(view.container)).toEqual(['VIP', 'Laser']);
    const copies = view.container.querySelectorAll<HTMLElement>('.evt[data-booking-id="visit"]');
    expect(copies).toHaveLength(2);
    expect([...copies].map((el) => Number(el.dataset.sub)).sort()).toEqual([0, 1]);
  });

  it('HC-020: unions category across box.members (a visit spanning two categories gets two lane copies)', () => {
    const view = mount({
      subBy: 'category',
      categories: [
        { name: 'Laser', color: '#aa0000' },
        { name: 'Facial', color: '#00aa00' },
      ],
      bookings: [
        booking('visit', '2026-09-08', 9, {
          category: 'Laser',
          categoryColor: '#aa0000',
          groupId: 'g2',
          groupSeq: 0,
        }),
        booking('visit-svc2', '2026-09-08', 9, {
          category: 'Facial',
          categoryColor: '#00aa00',
          groupId: 'g2',
          groupSeq: 1,
        }),
      ],
    });
    expect(laneLabels(view.container)).toEqual(['Laser', 'Facial']);
    const copies = view.container.querySelectorAll<HTMLElement>('.evt[data-booking-id="visit"]');
    expect(copies).toHaveLength(2);
    expect([...copies].map((el) => Number(el.dataset.sub)).sort()).toEqual([0, 1]);
  });
});

describe('HC-018 — a custom column lists Unclassified only once its values are in', () => {
  const PROP = '55555555-5555-4555-8555-555555555555';
  const definition = {
    id: PROP,
    tableId: 'scheduling.bookings',
    label: 'Room',
    type: 'select',
    rules: {
      type: 'select',
      options: [
        { id: 'a', label: 'Room A', color: null, archivedAt: null },
        { id: 'b', label: 'Room B', color: null, archivedAt: null },
      ],
    },
    hasDefault: false,
    defaultValue: null,
    archivedAt: null,
    version: 1,
  };
  const cell = (id: string, value: string) => ({
    propertyId: PROP,
    recordId: id,
    present: true,
    value,
    effectiveValue: value,
    version: 1,
    updatedAt: null,
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  /** Definitions answer at once; the VALUES query waits on `gate`, which is
   *  the window the bug lived in — every booking reads as unset while the
   *  bundle is in flight, and the session is append-only. */
  function stubFetch(valueOf: (id: string) => string | null, gate: Promise<void>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/tables/properties/values/query')) {
          const { recordIds } = JSON.parse(String(init?.body)) as { recordIds: string[] };
          await gate;
          return json({
            definitions: [definition],
            values: Object.fromEntries(
              recordIds.map((id) => {
                const v = valueOf(id);
                return [id, v === null ? {} : { [PROP]: cell(id, v) }];
              }),
            ),
            recordAccess: Object.fromEntries(recordIds.map((id) => [id, { canEdit: true }])),
            canManage: false,
            canEdit: true,
          });
        }
        if (url.startsWith('/api/tables/properties'))
          return json({ definitions: [definition], canManage: false, canEdit: true });
        return new Response(null, { status: 404 });
      }),
    );
  }

  const BOOKINGS = [booking('a1', '2026-09-08', 9), booking('a2', '2026-09-09', 10)];

  it('shows the options only while the bundle loads, and no Unclassified lane once every booking is classified', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stubFetch(() => 'a', gate);
    const view = mount({ subBy: `prop:${PROP}`, bookings: BOOKINGS });

    // Definitions are in, values are NOT: the lanes are the column's options.
    await waitFor(() => expect(laneLabels(view.container)).toEqual(['Room A', 'Room B']));

    release();
    await waitFor(() => expect(laneOf(view.container, 'a1')).toBe(0));
    expect(laneLabels(view.container)).toEqual(['Room A', 'Room B']);
  });

  it('appends the Unclassified lane for a booking that is genuinely unset after the load', async () => {
    stubFetch((id) => (id === 'a2' ? null : 'a'), Promise.resolve());
    const view = mount({ subBy: `prop:${PROP}`, bookings: BOOKINGS });
    await waitFor(() =>
      expect(laneLabels(view.container)).toEqual(['Room A', 'Room B', 'Unclassified']),
    );
    expect(laneOf(view.container, 'a2')).toBe(2);
  });
});
