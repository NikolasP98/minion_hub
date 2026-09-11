import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CalEvent, CalendarPayload } from './types';

const fetchJson = vi.fn<(...args: unknown[]) => Promise<CalendarPayload>>();
vi.mock('$lib/api/fetch-json', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('$lib/state/ui', () => ({ toastError: vi.fn() }));

const { CalendarStore, offsetIso } = await import('./calendar.svelte');

function ev(id: string, patch: Partial<CalEvent> = {}): CalEvent {
  return {
    id,
    start: '2026-09-08T09:00:00.000Z',
    end: '2026-09-08T10:00:00.000Z',
    status: 'accepted',
    resourceId: 'r1',
    resourceName: 'Alice',
    resourceColor: '#111111',
    kindId: null,
    eventTypeId: 'et1',
    eventTypeTitle: 'Consult',
    title: null,
    notes: null,
    crmContactId: null,
    attendeeName: 'Bob',
    attendeePhone: null,
    productId: null,
    productName: null,
    tags: [],
    contactTags: [],
    productTags: [],
    ...patch,
  };
}

describe('CalendarStore', () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it('ensure() fetches only the missing sub-span of an already-loaded window', async () => {
    const store = new CalendarStore();
    fetchJson.mockResolvedValueOnce({
      from: '2026-09-08T00:00:00.000Z',
      to: '2026-09-15T00:00:00.000Z',
      events: [ev('a')],
    });

    await store.ensure(new Date('2026-09-08T00:00:00.000Z'), new Date('2026-09-15T00:00:00.000Z'));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(store.events['a']).toBeDefined();

    // Fully inside the already-loaded window — no new request.
    await store.ensure(new Date('2026-09-09T00:00:00.000Z'), new Date('2026-09-10T00:00:00.000Z'));
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // Partially overlapping — only the missing tail is requested.
    fetchJson.mockResolvedValueOnce({
      from: '2026-09-15T00:00:00.000Z',
      to: '2026-09-18T00:00:00.000Z',
      events: [],
    });
    await store.ensure(new Date('2026-09-10T00:00:00.000Z'), new Date('2026-09-18T00:00:00.000Z'));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const secondCallUrl = String(fetchJson.mock.calls[1]![0]);
    expect(secondCallUrl).toContain(encodeURIComponent('2026-09-15T00:00:00.000Z'));
  });

  it('kindOf() resolves a null event kind to the org default', () => {
    const store = new CalendarStore();
    store.setKinds([
      { id: 'k1', name: 'Appointment', color: '#3b82f6', isDefault: true, position: 0 },
      { id: 'k2', name: 'Block', color: '#6b7280', isDefault: false, position: 1 },
    ]);
    expect(store.kindOf(ev('a', { kindId: null }))?.id).toBe('k1');
    expect(store.kindOf(ev('a', { kindId: 'k2' }))?.id).toBe('k2');
  });

  it('visible respects the staff and kind filters', () => {
    const store = new CalendarStore();
    store.mergeEvents(
      [ev('a', { resourceId: 'r1', kindId: 'k1' }), ev('b', { resourceId: 'r2', kindId: 'k2' })],
      '2026-09-08T00:00:00.000Z',
      '2026-09-09T00:00:00.000Z',
    );
    expect(store.visible.map((e) => e.id).sort()).toEqual(['a', 'b']);

    store.staff = new Set(['r1']);
    expect(store.visible.map((e) => e.id)).toEqual(['a']);

    store.staff = new Set();
    store.kindId = 'k2';
    expect(store.visible.map((e) => e.id)).toEqual(['b']);
  });

  it('patchEvent() merges a partial update onto an existing event only', () => {
    const store = new CalendarStore();
    store.mergeEvents([ev('a')], '2026-09-08T00:00:00.000Z', '2026-09-09T00:00:00.000Z');

    store.patchEvent('a', { start: '2026-09-08T11:00:00.000Z', end: '2026-09-08T12:00:00.000Z' });
    expect(store.events['a']!.start).toBe('2026-09-08T11:00:00.000Z');
    expect(store.events['a']!.eventTypeTitle).toBe('Consult'); // untouched fields survive

    store.patchEvent('missing', { start: '2026-01-01T00:00:00.000Z' });
    expect(store.events['missing']).toBeUndefined(); // no-op on an unknown id
  });
});

describe('offsetIso', () => {
  /** @event-calendar/core's `parseOffset` — src/lib/date.js. A `Z` suffix does not match. */
  const EC_PARSE_OFFSET = /([+-])(\d{2}):(\d{2})$/;

  it('keeps the instant but states the offset the calendar library can parse', () => {
    const d = new Date('2026-09-08T13:00:00.000Z');
    const iso = offsetIso(d);
    expect(iso).toBe('2026-09-08T13:00:00.000+00:00');
    expect(new Date(iso).getTime()).toBe(d.getTime());
    expect(EC_PARSE_OFFSET.test(iso)).toBe(true);
    // The bug: the same instant via toISOString() carries no parseable offset, so
    // a chip patched with it after a drag jumps back to its UTC wall clock.
    expect(EC_PARSE_OFFSET.test(d.toISOString())).toBe(false);
  });

  it('is what a moved event is written back with, so it survives a store patch', () => {
    const store = new CalendarStore();
    store.mergeEvents([ev('a')], '2026-09-08T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    // Dropped one hour later: the library hands back a local Date for the new slot.
    const dropped = new Date('2026-09-08T14:00:00.000Z');
    store.patchEvent('a', { start: offsetIso(dropped) });
    expect(EC_PARSE_OFFSET.test(store.events['a']!.start)).toBe(true);
    expect(new Date(store.events['a']!.start).getTime()).toBe(dropped.getTime());
  });
});
