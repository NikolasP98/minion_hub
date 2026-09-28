/**
 * Synthetic Home/Calendar seed. Six staff and overlapping bookings, no
 * production identifiers, no credentials, no network. Deterministic: every
 * timestamp derives from FIXTURE_DAY, never from `Date.now()`.
 *
 * Shapes follow `BookingCalendar`'s own contract (`calendar-window.ts`) since
 * spec 2026-09-27 S3 put `/scheduling/calendar` on the shared grid — the old
 * `CalEvent` denormalised shape belonged to the retired `@event-calendar` view.
 */
import type {
  CalendarBooking,
  CalendarBookingTag,
} from '$lib/components/scheduling/calendar-window';

export const FIXTURE_DAY = '2026-09-08';

export const RESOURCES = [
  { id: 'r1', name: 'Leiva', color: '#4f8ff7' },
  { id: 'r2', name: 'Martin', color: '#f77f4f' },
  { id: 'r3', name: 'Nikolas Pinon', color: '#4ff7a1' },
  { id: 'r4', name: 'Nikolas Sarria', color: '#f74f9f' },
  { id: 'r5', name: 'Nikolas Sebastian Pinon Sarria', color: '#c14ff7' },
  { id: 'r6', name: 'Renzo GT', color: '#f7d24f' },
];

export const KINDS = [
  { id: 'k1', name: 'Consulta', color: '#4f8ff7', isDefault: true },
  { id: 'k2', name: 'Procedimiento', color: '#f74f9f', isDefault: false },
];

export const EVENT_TYPES = [
  {
    id: 'et0',
    title: 'Consulta inicial',
    productId: null,
    active: true,
    length: 45,
    resourceIds: RESOURCES.map((r) => r.id),
    color: null,
    kindId: 'k1',
  },
  {
    id: 'et1',
    title: 'Afinamiento facial',
    productId: null,
    active: true,
    length: 45,
    resourceIds: RESOURCES.map((r) => r.id),
    color: null,
    kindId: 'k2',
  },
];

/** The event's own VIP tag — the colour the block paints when `blockColorBy` is
 *  the default `tag` source, asserted by calendar-interactions.spec.ts. */
const OWN_TAG: CalendarBookingTag = { id: 't1', name: 'VIP', color: '#f7d24f', origin: 'own' };
const CONTACT_TAG: CalendarBookingTag = {
  id: 'ct1',
  name: 'VIP Cliente',
  color: '#22c55e',
  origin: 'contact',
};

export const TAG_OPTIONS = [
  { id: OWN_TAG.id, name: OWN_TAG.name, color: OWN_TAG.color },
  { id: CONTACT_TAG.id, name: CONTACT_TAG.name, color: CONTACT_TAG.color, origin: 'contact' },
] as const;

function iso(hh: number, mm: number): string {
  const d = new Date(`${FIXTURE_DAY}T00:00:00`);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function booking(
  id: string,
  resourceId: string,
  start: string,
  end: string,
  attendeeName: string,
  overrides: Partial<CalendarBooking> = {},
): CalendarBooking {
  return {
    id,
    resourceId,
    eventTypeId: 'et0',
    start,
    end,
    status: 'accepted',
    attendeeName,
    attendeePhone: null,
    notes: null,
    productId: null,
    partyId: null,
    groupId: null,
    groupSeq: null,
    groupLength: null,
    checkup: false,
    tags: [OWN_TAG],
    kindId: 'k1',
    categoryColor: null,
    ...overrides,
  };
}

/** Two 45-minute bookings per staff member; neighbouring staff overlap in time. */
export const EVENTS: CalendarBooking[] = RESOURCES.flatMap((r, i) =>
  [0, 1].map((n) => {
    const start = iso(8 + (i % 3) + n * 4, n === 0 ? 0 : 30);
    return booking(
      `${r.id}-${n}`,
      r.id,
      start,
      new Date(new Date(start).getTime() + 45 * 60_000).toISOString(),
      `Paciente ${i + 1}${n === 0 ? 'A' : 'B'}`,
      { eventTypeId: `et${n}`, kindId: n === 0 ? 'k1' : 'k2' },
    );
  }),
);

// Extra bookings for the calendar-interactions spec: own-tag colour is already
// covered by every booking above. These add the three cases that aren't: a
// contact-inherited tag with no own tag, an overlapping pair for the
// 409-conflict path, and one starting before the grid's 07:00 floor.
export const CONTACT_TAG_EVENT_ID = 'r4-contact-tag';
export const OVERLAP_EVENT_A_ID = 'r5-overlap-a';
export const OVERLAP_EVENT_B_ID = 'r5-overlap-b';
export const PRE_WINDOW_EVENT_ID = 'r6-pre-window';

EVENTS.push(
  booking(CONTACT_TAG_EVENT_ID, 'r4', iso(16, 0), iso(16, 45), 'Paciente ContactTag', {
    tags: [CONTACT_TAG],
  }),
  // Two bookings on the same staff lane, overlapping in time, so a move onto
  // one from the other reads as a real conflict (the PATCH stub decides the
  // response; the fixture data just makes the scenario legible).
  booking(OVERLAP_EVENT_A_ID, 'r5', iso(18, 0), iso(18, 45), 'Paciente Overlap A'),
  booking(OVERLAP_EVENT_B_ID, 'r5', iso(18, 20), iso(19, 5), 'Paciente Overlap B'),
  // Starts before the day grid's 07:00 floor — the grid clips the box to the
  // grid start, so it must still render, just short.
  booking(PRE_WINDOW_EVENT_ID, 'r6', iso(6, 0), iso(7, 20), 'Paciente PreWindow'),
);

export const FROM = iso(0, 0);
export const TO = new Date(new Date(FROM).getTime() + 86_400_000).toISOString();
