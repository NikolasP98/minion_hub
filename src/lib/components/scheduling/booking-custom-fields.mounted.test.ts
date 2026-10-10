// @vitest-environment happy-dom
/**
 * HC-019 — a custom booking column has ONE read/edit truth on every booking
 * surface for the same persona (cluster invariant 6). Mounts the shared
 * `BookingCustomFields` section, the detail drawer, `BookingsView`, the
 * calendar Table and the calendar Board over one `createBookingCustomValues`
 * store fed by a stubbed `fetch`, and asserts that a seeded value renders the
 * same label/value on all of them: editable for a persona with record edit,
 * read-only for one without, absent when the definitions call is refused.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { page } from '$app/state';
import type { CustomPropertyDefinition, CustomPropertyValue } from '$lib/tables/custom-properties';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
// DataTable mounts rows only `if (browser)` (its row virtualizer).
vi.mock('$app/environment', async (original) => ({
  ...(await original<typeof import('$app/environment')>()),
  browser: true,
}));
vi.mock('$app/navigation', async (original) => ({
  ...(await original<typeof import('$app/navigation')>()),
  invalidate: vi.fn(),
  goto: vi.fn(),
}));

const { default: BookingCustomFields } = await import('./BookingCustomFields.svelte');
const { default: BookingDetailDrawer } = await import('./BookingDetailDrawer.svelte');
const { default: BookingsView } = await import('./BookingsView.svelte');
const { default: BookingTable } = await import('./BookingTable.svelte');
const { default: BookingBoard } = await import('./BookingBoard.svelte');
const { createBookingCustomValues, PROP_PREFIX } =
  await import('./kit/booking-custom-values.svelte');

const BOOKING = 'b1';
const TZ = 'America/Lima';
const DEF: CustomPropertyDefinition = {
  id: 'prop-room',
  tableId: 'scheduling.bookings',
  label: 'Room',
  description: null,
  type: 'select',
  rules: {
    type: 'select',
    options: [
      { id: 'opt-a', label: 'Room A', color: '#3b82f6', archivedAt: null },
      { id: 'opt-b', label: 'Room B', color: '#10b981', archivedAt: null },
    ],
  },
  hasDefault: false,
  defaultValue: null,
  presentation: null,
  version: 1,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const DETAIL = {
  booking: {
    id: BOOKING,
    status: 'accepted',
    title: null,
    eventTypeId: 'et1',
    resourceId: 'r1',
    productId: null,
    partyId: null,
    startTime: '2026-10-07T14:00:00.000Z',
    endTime: '2026-10-07T15:00:00.000Z',
    attendeeName: 'Ana',
    attendeeEmail: null,
    attendeePhone: null,
    crmContactId: null,
    notes: null,
    clientNote: null,
  },
  eventType: { id: 'et1', title: 'Consulta' },
  resource: { id: 'r1', name: 'Leiva', profileId: null },
  contact: null,
  statusHistory: [],
  grant: null,
  plan: null,
  series: null,
  accrual: null,
  tickets: [],
  tags: { own: [], contact: [], service: [] },
};
const CALENDAR_BOOKING = {
  id: BOOKING,
  resourceId: 'r1',
  eventTypeId: 'et1',
  start: DETAIL.booking.startTime,
  end: DETAIL.booking.endTime,
  status: 'accepted',
  attendeeName: 'Ana',
};
const RESOURCES = [{ id: 'r1', name: 'Leiva', color: null }];
const EVENT_TYPES = [{ id: 'et1', title: 'Consulta' }];
const LIST_DATA = {
  orgTz: TZ,
  bookings: [
    {
      id: BOOKING,
      status: 'accepted',
      startTime: DETAIL.booking.startTime,
      eventTypeId: 'et1',
      resourceId: 'r1',
      attendeeName: 'Ana',
      attendeePhone: null,
    },
  ],
  resources: [{ id: 'r1', name: 'Leiva' }],
  eventTypes: [{ id: 'et1', title: 'Consulta', productId: null }],
  stockEnabled: false,
  accrualSummaries: [],
};

type Persona = 'allowed' | 'restricted' | 'refused';
const stored: Record<string, CustomPropertyValue> = {};
const puts: Array<Record<string, unknown>> = [];
const cellOf = (id: string, version = 3) => ({
  propertyId: DEF.id,
  recordId: id,
  present: stored[id] != null,
  value: stored[id] ?? null,
  effectiveValue: stored[id] ?? null,
  version,
  updatedAt: '2026-10-02T00:00:00.000Z',
});
function installFetch(persona: Persona) {
  const canEdit = persona === 'allowed';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/tables/properties?')) {
        if (persona === 'refused') return new Response(null, { status: 403 });
        return Response.json({ definitions: [DEF], canManage: false, canEdit });
      }
      if (url === '/api/tables/properties/values/query') {
        const { recordIds } = JSON.parse(String(init?.body)) as { recordIds: string[] };
        return Response.json({
          definitions: [DEF],
          values: Object.fromEntries(recordIds.map((id) => [id, { [DEF.id]: cellOf(id) }])),
          recordAccess: Object.fromEntries(recordIds.map((id) => [id, { canEdit }])),
          canManage: false,
          canEdit,
        });
      }
      if (url === '/api/tables/properties/values' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        puts.push(body);
        if (!canEdit) return new Response(null, { status: 403 });
        stored[body.recordId as string] = body.value as CustomPropertyValue;
        return Response.json({ cell: cellOf(body.recordId as string, 4) });
      }
      if (url === `/api/scheduling/bookings/${BOOKING}`) return Response.json(DETAIL);
      if (url.startsWith('/api/tags')) return Response.json({ tags: [] });
      return new Response(null, { status: 404 });
    }),
  );
}
async function store(persona: Persona) {
  installFetch(persona);
  const cv = createBookingCustomValues();
  await cv.load();
  return cv;
}
/** The one value control the shared section renders for `Room`. */
function roomRow(container: HTMLElement) {
  const dt = [...container.querySelectorAll('dt')].find((el) => el.textContent?.trim() === 'Room');
  expect(dt, 'a "Room" fact row').toBeTruthy();
  const dd = dt!.nextElementSibling as HTMLElement;
  return { dd, button: dd.querySelector('button') };
}

beforeAll(() => {
  // happy-dom lays nothing out: DataTable's row virtualizer needs a viewport
  // height to mount any row (same stub as DataTable.test.ts).
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  stored[BOOKING] = 'opt-a';
  puts.length = 0;
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: { permissions: ['scheduling:view', 'scheduling:edit'] },
  };
  page.status = 200;
  page.error = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  page.data = {};
});

describe('BookingCustomFields (the shared section)', () => {
  it('allowed persona: the seeded value is an editable row and a save calls apply once', async () => {
    const cv = await store('allowed');
    const apply = vi.spyOn(cv, 'apply');
    cv.ensure([BOOKING]);
    const view = render(BookingCustomFields, { customValues: cv, bookingId: BOOKING });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    const { button } = roomRow(view.container);
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(false);
    await fireEvent.click(button!);
    const editor = within(view.container);
    await fireEvent.click(editor.getByRole('button', { name: /Room B/ }));
    await fireEvent.click(editor.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      tableId: 'scheduling.bookings',
      propertyId: DEF.id,
      recordId: BOOKING,
      value: 'opt-b',
      expectedVersion: 3,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cv.values[BOOKING]?.[DEF.id]?.value).toBe('opt-b'));
    await waitFor(() => expect(view.container.textContent).toContain('Room B'));
  });

  it('restricted persona: the same value renders read-only (no enabled editor)', async () => {
    const cv = await store('restricted');
    cv.ensure([BOOKING]);
    const view = render(BookingCustomFields, { customValues: cv, bookingId: BOOKING });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    const { button } = roomRow(view.container);
    expect(button?.disabled ?? true).toBe(true);
    expect(view.container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('definitions refused (403): the section is absent', async () => {
    const cv = await store('refused');
    expect(cv.failed).toBe(true);
    cv.ensure([BOOKING]);
    const view = render(BookingCustomFields, { customValues: cv, bookingId: BOOKING });
    await tick();
    expect(view.container.textContent?.trim()).toBe('');
    expect(view.container.querySelector('dt')).toBeNull();
  });
});

describe('BookingDetailDrawer', () => {
  it('shows the seeded value after the overview, editable for the allowed persona', async () => {
    const cv = await store('allowed');
    const view = render(BookingDetailDrawer, {
      bookingId: BOOKING,
      customValues: cv,
      timeZone: TZ,
      mutationScope: 'scheduling:org-a',
      onclose: () => {},
    });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    expect(view.container.textContent).toContain('Custom fields');
    const { button } = roomRow(view.container);
    expect(button!.disabled).toBe(false);
    // The custom section follows the overview, services and payment blocks,
    // before Notes (single-event model, calendar cluster S5 rebase).
    const text = view.container.textContent ?? '';
    expect(text.indexOf('Overview')).toBeLessThan(text.indexOf('Payment'));
    expect(text.indexOf('Payment')).toBeLessThan(text.indexOf('Room A'));
    expect(text.indexOf('Room A')).toBeLessThan(text.indexOf('Notes'));
  });

  it('restricted persona: the same value, read-only', async () => {
    const cv = await store('restricted');
    const view = render(BookingDetailDrawer, {
      bookingId: BOOKING,
      customValues: cv,
      timeZone: TZ,
      mutationScope: 'scheduling:org-a',
      onclose: () => {},
    });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    const { button } = roomRow(view.container);
    expect(button?.disabled ?? true).toBe(true);
  });

  it('without a store (legacy host) the drawer renders no custom section', async () => {
    installFetch('allowed');
    const view = render(BookingDetailDrawer, {
      bookingId: BOOKING,
      timeZone: TZ,
      mutationScope: 'scheduling:org-a',
      onclose: () => {},
    });
    await waitFor(() => expect(view.container.textContent).toContain('Consulta'));
    expect(view.container.textContent).not.toContain('Custom fields');
    expect(view.container.textContent).not.toContain('Room');
  });
});

describe('BookingsView', () => {
  it('allowed: the card shows the value read-only and its drawer shows it editable', async () => {
    installFetch('allowed');
    const view = render(BookingsView, {
      data: LIST_DATA,
      capabilities: { createSalesOrder: false },
      invalidateKey: 'scheduling:data',
    });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    // Card line: label + value, no editor on the card.
    const card = view.container.querySelector('.bcf-summary')!;
    expect(card.textContent?.replace(/\s+/g, ' ')).toContain('Room: Room A');
    expect(card.querySelector('button')).toBeNull();
    await fireEvent.click(view.getByTitle('Open appointment detail'));
    await waitFor(() => expect(view.container.textContent).toContain('Custom fields'));
    const { button } = roomRow(view.container);
    expect(button!.disabled).toBe(false);
  });

  it('restricted: the card shows the value and the drawer is read-only', async () => {
    installFetch('restricted');
    const view = render(BookingsView, {
      data: LIST_DATA,
      capabilities: { createSalesOrder: false },
      invalidateKey: 'scheduling:data',
    });
    await waitFor(() => expect(view.container.textContent).toContain('Room A'));
    await fireEvent.click(view.getByTitle('Open appointment detail'));
    await waitFor(() => expect(view.container.textContent).toContain('Custom fields'));
    const { button } = roomRow(view.container);
    expect(button?.disabled ?? true).toBe(true);
  });

  it('refused: no custom line on the card, no section in the drawer', async () => {
    installFetch('refused');
    const view = render(BookingsView, {
      data: LIST_DATA,
      capabilities: { createSalesOrder: false },
      invalidateKey: 'scheduling:data',
    });
    await waitFor(() => expect(view.container.textContent).toContain('Consulta'));
    await fireEvent.click(view.getByTitle('Open appointment detail'));
    await waitFor(() => expect(view.container.textContent).toContain('Overview'));
    expect(view.container.textContent).not.toContain('Room');
    expect(view.container.querySelector('.bcf-summary')).toBeNull();
  });
});

describe('calendar Table and Board (unchanged surfaces) agree with the section', () => {
  it.each<[Persona, boolean]>([
    ['allowed', true],
    ['restricted', false],
  ])('%s persona: same label/value on Table, Board and the section', async (persona, canEdit) => {
    const cv = await store(persona);
    const table = render(BookingTable, {
      bookings: [CALENDAR_BOOKING],
      resources: RESOURCES,
      eventTypes: EVENT_TYPES,
      timeZone: TZ,
      customValues: cv,
      scopeKey: 'org-a',
      onopen: () => {},
    });
    await waitFor(() => expect(table.container.textContent).toContain('Room A'));
    expect(table.container.textContent).toContain('Room');
    expect(cv.bundle().recordAccess[BOOKING]).toEqual({ canEdit });
    expect(cv.bundle().canEdit).toBe(canEdit);
    const board = render(BookingBoard, {
      bookings: [CALENDAR_BOOKING],
      resources: RESOURCES,
      eventTypes: EVENT_TYPES,
      timeZone: TZ,
      customValues: cv,
      axis: PROP_PREFIX + DEF.id,
      onaxis: () => {},
      onopen: () => {},
    });
    await waitFor(() => expect(board.container.textContent).toContain('Room A'));
    const section = render(BookingCustomFields, { customValues: cv, bookingId: BOOKING });
    await waitFor(() => expect(section.container.textContent).toContain('Room A'));
    const { button } = roomRow(section.container);
    expect(button?.disabled ?? true).toBe(!canEdit);
  });
});
