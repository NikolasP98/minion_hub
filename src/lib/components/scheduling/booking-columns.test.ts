import { describe, expect, it } from 'vitest';
import { bookingBoxColumns } from './booking-columns';
import { groupBookings, type BookingBox } from './booking-groups';
import type { CalendarBooking } from './calendar-window';
import { applyFilters } from '$lib/components/data-table/apply-filters';
import { columnMatchOf, filterColumnMetas } from '$lib/components/data-table/filter-columns';
import { customPropertyColumns } from '$lib/components/data-table/custom-properties/columns';
import type { CustomPropertyBundle, CustomPropertyDefinition } from '$lib/tables/custom-properties';
import type { FilterGroup, FilterValue } from '$lib/components/data-table/filters';

/**
 * What the appointments page runs when its calendar/board share the table's
 * filter: bookings → events → the table's own columns → `applyFilters` → the
 * ids the views may draw.
 */
const booking = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
  resourceId: 'r1',
  eventTypeId: 'e1',
  start: '2026-09-25T09:00:00.000Z',
  end: '2026-09-25T10:00:00.000Z',
  status: 'accepted',
  attendeeName: 'Ana',
  ...over,
});

const ROOM: CustomPropertyDefinition = {
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

const cell = (value: string) => ({
  propertyId: ROOM.id,
  recordId: '',
  present: true,
  value,
  effectiveValue: value,
  version: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const bundle: CustomPropertyBundle = {
  definitions: [ROOM],
  values: { a: { [ROOM.id]: cell('opt-a') }, b: { [ROOM.id]: cell('opt-b') } },
  recordAccess: {},
  canManage: false,
  canEdit: false,
};

const bookings = [
  booking({ id: 'a', partyId: 'p1', attendeeName: 'Ana Pérez' }),
  booking({ id: 'b', partyId: 'p2', attendeeName: 'Bruno Díaz', status: 'cancelled' }),
  // One EVENT of two services (same client, same chair, one groupId).
  booking({ id: 'c1', partyId: 'p3', attendeeName: 'Caro', groupId: 'g1', groupSeq: 0 }),
  booking({ id: 'c2', partyId: 'p3', attendeeName: 'Caro', groupId: 'g1', groupSeq: 1 }),
];

function keptIds(filters: Record<string, FilterValue>, advanced: FilterGroup | null = null) {
  const boxes = groupBookings(bookings);
  const columns = [
    ...bookingBoxColumns({
      resources: [{ id: 'r1', name: 'Chair 1' }],
      eventTypes: [{ id: 'e1', title: 'Limpieza' }],
      timeZone: 'America/Lima',
      rows: boxes,
    }),
    ...customPropertyColumns<BookingBox>(bundle, (box) => box.lead.id).map((c) => c.column),
  ];
  const kept = applyFilters(boxes, filters, advanced, columnMatchOf(columns));
  return kept.flatMap((box) => box.members.map((member) => member.id)).sort();
}

describe('booking filters across views', () => {
  it('collapses the two services of one event into a single row', () => {
    expect(groupBookings(bookings).map((box) => box.members.map((member) => member.id))).toEqual([
      ['a'],
      ['b'],
      ['c1', 'c2'],
    ]);
  });

  it('lists every table column in the filter menu, custom properties included', () => {
    const boxes = groupBookings(bookings);
    const metas = filterColumnMetas(
      [
        ...bookingBoxColumns({
          resources: [{ id: 'r1', name: 'Chair 1' }],
          eventTypes: [{ id: 'e1', title: 'Limpieza' }],
          timeZone: 'America/Lima',
          rows: boxes,
        }),
        ...customPropertyColumns<BookingBox>(bundle, (box) => box.lead.id).map((c) => c.column),
      ],
      boxes,
    );
    expect(metas.map((meta) => meta.key)).toEqual([
      'when',
      'client',
      'service',
      'staff',
      'status',
      'custom:prop-room',
    ]);
    expect(metas.find((meta) => meta.key === 'status')?.kind).toBe('enum');
    expect(metas.find((meta) => meta.key === 'client')?.kind).toBe('text');
    expect(metas.find((meta) => meta.key === 'custom:prop-room')?.options).toEqual([
      { value: 'opt-a', label: 'Room A' },
      { value: 'opt-b', label: 'Room B' },
    ]);
  });

  it('keeps the events a text rule matches', () => {
    expect(keptIds({ client: { kind: 'text', text: 'caro' } })).toEqual(['c1', 'c2']);
  });

  it('keeps the events a select rule matches', () => {
    expect(keptIds({ status: { kind: 'enum', values: ['cancelled'] } })).toEqual(['b']);
  });

  it('ANDs the two rules', () => {
    expect(
      keptIds({
        client: { kind: 'text', text: 'caro' },
        status: { kind: 'enum', values: ['cancelled'] },
      }),
    ).toEqual([]);
  });

  it('filters on a custom property the table can filter on', () => {
    expect(keptIds({ 'custom:prop-room': { kind: 'enum', values: ['opt-b'] } })).toEqual(['b']);
  });

  it('keeps or drops a multi-service event as ONE row', () => {
    // The rule matches the lead's value; both members ride with it.
    expect(keptIds({ staff: { kind: 'enum', values: ['r1'] } })).toEqual(['a', 'b', 'c1', 'c2']);
  });
});
