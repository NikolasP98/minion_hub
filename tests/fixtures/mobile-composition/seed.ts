/**
 * Synthetic Home/Calendar seed. Six staff and overlapping bookings, no
 * production identifiers, no credentials, no network. Deterministic: every
 * timestamp derives from FIXTURE_DAY, never from `Date.now()`.
 */
import type { CalEvent, CalKind } from '$lib/components/scheduling/calendar/types';

export const FIXTURE_DAY = '2026-09-08';

export const RESOURCES = [
  { id: 'r1', name: 'Leiva', color: '#4f8ff7' },
  { id: 'r2', name: 'Martin', color: '#f77f4f' },
  { id: 'r3', name: 'Nikolas Pinon', color: '#4ff7a1' },
  { id: 'r4', name: 'Nikolas Sarria', color: '#f74f9f' },
  { id: 'r5', name: 'Nikolas Sebastian Pinon Sarria', color: '#c14ff7' },
  { id: 'r6', name: 'Renzo GT', color: '#f7d24f' },
];

export const KINDS: CalKind[] = [
  { id: 'k1', name: 'Consulta', color: '#4f8ff7', isDefault: true, position: 0 },
  { id: 'k2', name: 'Procedimiento', color: '#f74f9f', isDefault: false, position: 1 },
];

function iso(hh: number, mm: number): string {
  const d = new Date(`${FIXTURE_DAY}T00:00:00`);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** Two 45-minute bookings per staff member; neighbouring staff overlap in time. */
export const EVENTS: CalEvent[] = RESOURCES.flatMap((r, i) =>
  [0, 1].map((n) => {
    const startHour = 8 + (i % 3) + n * 4;
    const startMin = n === 0 ? 0 : 30;
    const start = iso(startHour, startMin);
    return {
      id: `${r.id}-${n}`,
      start,
      end: new Date(new Date(start).getTime() + 45 * 60_000).toISOString(),
      status: 'confirmed',
      resourceId: r.id,
      resourceName: r.name,
      resourceColor: r.color,
      kindId: n === 0 ? 'k1' : 'k2',
      eventTypeId: `et${n}`,
      eventTypeTitle: n === 0 ? 'Consulta inicial' : 'Afinamiento facial',
      title: null,
      notes: null,
      crmContactId: null,
      attendeeName: `Paciente ${i + 1}${n === 0 ? 'A' : 'B'}`,
      attendeePhone: null,
      productId: null,
      productName: null,
      tags: [{ id: 't1', name: 'VIP', color: '#f7d24f' }],
      contactTags: [],
      productTags: [],
    } satisfies CalEvent;
  }),
);

// Extra events for the calendar-interactions spec (S9): own-tag colour is
// already covered by every event above (`tags: [t1]`). These add the three
// cases that aren't: a contact-inherited tag with no own tag, an overlapping
// pair for the 409-conflict path, and an event starting before the grid's
// 07:00 floor (clipped-but-present rendering).
export const CONTACT_TAG_EVENT_ID = 'r4-contact-tag';
export const OVERLAP_EVENT_A_ID = 'r5-overlap-a';
export const OVERLAP_EVENT_B_ID = 'r5-overlap-b';
export const PRE_WINDOW_EVENT_ID = 'r6-pre-window';

function extraEvent(
  id: string,
  resource: (typeof RESOURCES)[number],
  start: string,
  end: string,
  attendeeName: string,
  overrides: Partial<CalEvent> = {},
): CalEvent {
  return {
    id,
    start,
    end,
    status: 'confirmed',
    resourceId: resource.id,
    resourceName: resource.name,
    resourceColor: resource.color,
    kindId: 'k1',
    eventTypeId: 'et0',
    eventTypeTitle: 'Consulta inicial',
    title: null,
    notes: null,
    crmContactId: null,
    attendeeName,
    attendeePhone: null,
    productId: null,
    productName: null,
    tags: [],
    contactTags: [],
    productTags: [],
    ...overrides,
  } satisfies CalEvent;
}

EVENTS.push(
  // No own tag; a coloured tag inherited from the linked CRM contact.
  extraEvent(CONTACT_TAG_EVENT_ID, RESOURCES[3], iso(16, 0), iso(16, 45), 'Paciente ContactTag', {
    crmContactId: 'c-contact-tag',
    contactTags: [{ id: 'ct1', name: 'VIP Cliente', color: '#22c55e' }],
  }),
  // Two bookings on the same staff lane, overlapping in time, so a move onto
  // one from the other reads as a real conflict (the PATCH stub decides the
  // response; the fixture data just makes the scenario legible).
  extraEvent(OVERLAP_EVENT_A_ID, RESOURCES[4], iso(18, 0), iso(18, 45), 'Paciente Overlap A'),
  extraEvent(OVERLAP_EVENT_B_ID, RESOURCES[4], iso(18, 20), iso(19, 5), 'Paciente Overlap B'),
  // Starts before the day grid's 07:00 floor (slotMinTime) — the renderer
  // clips its chunk to the grid start, so it must still render, just short.
  extraEvent(PRE_WINDOW_EVENT_ID, RESOURCES[5], iso(6, 0), iso(7, 20), 'Paciente PreWindow'),
);

export const FROM = iso(0, 0);
export const TO = new Date(new Date(FROM).getTime() + 86_400_000).toISOString();
