/**
 * HC-019 evidence seed: ONE custom select column ("Room") on
 * `scheduling.bookings`, with a value on the first synthetic booking, and an
 * in-page `fetch` stub that answers the custom-property, booking-detail and
 * tag reads for two personas — `allowed` (scheduling edit) and `restricted`
 * (scheduling view only). No network, no credentials, no production data;
 * every other request is refused (404) exactly as the mounted tests do.
 */
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { EVENTS, EVENT_TYPES, RESOURCES } from './seed';

export type Persona = 'allowed' | 'restricted';

export const ROOM_DEF: CustomPropertyDefinition = {
  id: 'fixture-prop-room',
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
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};
export const SEEDED_EVENT = EVENTS[0];
export const SEEDED_VALUE = 'opt-a';

export function personaFromLocation(): Persona {
  return new URLSearchParams(location.search).get('persona') === 'restricted'
    ? 'restricted'
    : 'allowed';
}

export function installCustomFieldsFetch(persona: Persona) {
  const canEdit = persona === 'allowed';
  const stored: Record<string, string | null> = { [SEEDED_EVENT.id]: SEEDED_VALUE };
  const cell = (id: string, version = 3) => ({
    propertyId: ROOM_DEF.id,
    recordId: id,
    present: stored[id] != null,
    value: stored[id] ?? null,
    effectiveValue: stored[id] ?? null,
    version,
    updatedAt: '2026-09-02T00:00:00.000Z',
  });
  const eventType = EVENT_TYPES.find((e) => e.id === SEEDED_EVENT.eventTypeId) ?? null;
  const resource = RESOURCES.find((r) => r.id === SEEDED_EVENT.resourceId) ?? null;
  const detail = {
    booking: {
      id: SEEDED_EVENT.id,
      status: SEEDED_EVENT.status,
      title: null,
      eventTypeId: SEEDED_EVENT.eventTypeId,
      resourceId: SEEDED_EVENT.resourceId,
      productId: null,
      partyId: null,
      startTime: SEEDED_EVENT.start,
      endTime: SEEDED_EVENT.end,
      attendeeName: SEEDED_EVENT.attendeeName,
      attendeeEmail: null,
      attendeePhone: null,
      crmContactId: null,
      notes: null,
      clientNote: null,
    },
    eventType: eventType ? { id: eventType.id, title: eventType.title } : null,
    resource: resource ? { id: resource.id, name: resource.name, profileId: null } : null,
    contact: null,
    statusHistory: [],
    grant: null,
    plan: null,
    series: null,
    accrual: null,
    tickets: [],
    tags: { own: [], contact: [], service: [] },
  };
  const log: Array<{ method: string; url: string; body?: unknown }> = [];
  (window as unknown as { __fixtureFetchLog: typeof log }).__fixtureFetchLog = log;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ method, url, body });
    if (url.startsWith('/api/tables/properties?'))
      return Response.json({ definitions: [ROOM_DEF], canManage: false, canEdit });
    if (url === '/api/tables/properties/values/query') {
      const ids = (body as { recordIds: string[] }).recordIds;
      return Response.json({
        definitions: [ROOM_DEF],
        values: Object.fromEntries(ids.map((id) => [id, { [ROOM_DEF.id]: cell(id) }])),
        recordAccess: Object.fromEntries(ids.map((id) => [id, { canEdit }])),
        canManage: false,
        canEdit,
      });
    }
    if (url === '/api/tables/properties/values' && method === 'PUT') {
      if (!canEdit) return new Response(null, { status: 403 });
      const b = body as { recordId: string; value: string | null };
      stored[b.recordId] = b.value;
      return Response.json({ cell: cell(b.recordId, 4) });
    }
    if (url === `/api/scheduling/bookings/${SEEDED_EVENT.id}`) return Response.json(detail);
    if (url.startsWith('/api/tags')) return Response.json({ tags: [] });
    return new Response(null, { status: 404 });
  };
}
