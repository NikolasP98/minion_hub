import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CalEvent, CalendarPayload } from './types';

const fetchJson = vi.fn<(...args: unknown[]) => Promise<CalendarPayload>>();
vi.mock('$lib/api/fetch-json', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('$lib/state/ui', () => ({ toastError: vi.fn() }));

const { CalendarStore, offsetIso, calendarWallTime, calendarMoveIso, hhmm } =
  await import('./calendar.svelte');

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

// Exercise the installed library's real date/event boundaries, not a copied parser.
const coreRoot = dirname(
  createRequire(import.meta.url).resolve('@event-calendar/core/package.json'),
);
interface CoreEvent {
  start: Date;
  end: Date;
  extendedProps: CalEvent;
}
const { createEvents, toEventWithLocalDates } = (await import(
  /* @vite-ignore */ pathToFileURL(`${coreRoot}/src/lib/events.js`).href
)) as {
  createEvents(
    input: { start: string; end: string; extendedProps: CalEvent }[],
    offset: number,
  ): CoreEvent[];
  toEventWithLocalDates(event: CoreEvent): CoreEvent;
};
const { createDate, toLocalDate } = (await import(
  /* @vite-ignore */ pathToFileURL(`${coreRoot}/src/lib/date.js`).href
)) as { createDate(input: Date, offset: number): Date; toLocalDate(input: Date): Date };

function rendered(event: CalEvent): CoreEvent {
  return createEvents(
    [
      {
        start: calendarWallTime(event.start),
        end: calendarWallTime(event.end),
        extendedProps: event,
      },
    ],
    0,
  )[0]!;
}

describe('viewer-local calendar boundary', () => {
  it.each(['2026-01-15T14:00:00.123Z', '2026-07-15T14:00:00.999Z', '2026-09-08T03:15:00Z'])(
    'projects %s into the same local day and time used by the chip, regardless of current DST',
    (iso) => {
      const original = new Date(iso);
      const internal = rendered(
        ev('a', { start: iso, end: new Date(+original + 3600000).toISOString() }),
      );
      expect([
        internal.start.getUTCFullYear(),
        internal.start.getUTCMonth(),
        internal.start.getUTCDate(),
        internal.start.getUTCHours(),
        internal.start.getUTCMinutes(),
      ]).toEqual([
        original.getFullYear(),
        original.getMonth(),
        original.getDate(),
        original.getHours(),
        original.getMinutes(),
      ]);
      const callback = toEventWithLocalDates(internal);
      expect(hhmm(callback.start.toISOString())).toBe(hhmm(iso));
      expect(internal.extendedProps.start).toBe(iso);
    },
  );

  it('writes a changed drag through native callbacks, store patch and projection without shifting', () => {
    const event = ev('a', { start: '2026-01-15T14:00:00.123Z', end: '2026-01-15T15:00:00.456Z' });
    const old = rendered(event);
    const moved = {
      ...old,
      start: new Date(+old.start + 3600000),
      end: new Date(+old.end + 3600000),
    };
    const before = toEventWithLocalDates(old);
    const after = toEventWithLocalDates(moved);
    const store = new CalendarStore();
    store.mergeEvents([event], event.start, event.end);
    store.patchEvent(event.id, {
      start: calendarMoveIso(after.start, before.start, event.start),
      end: calendarMoveIso(after.end, before.end, event.end),
    });
    expect(new Date(store.events.a!.start).getTime()).toBe(after.start.getTime());
    expect(rendered(store.events.a!).start.getTime()).toBe(moved.start.getTime());
    expect(new Date(offsetIso(new Date(event.start))).getTime()).toBe(Date.parse(event.start));
  });

  it('preserves the untouched endpoint and milliseconds when resizing in the repeated fall-back hour', () => {
    const event = ev('fold', {
      start: '2026-11-01T06:30:00.123Z',
      end: '2026-11-01T07:30:00.456Z',
    });
    const internal = rendered(event);
    const old = toEventWithLocalDates(internal);
    const resized = toEventWithLocalDates({ ...internal, end: new Date(+internal.end + 900000) });
    expect(calendarMoveIso(resized.start, old.start, event.start)).toBe(event.start);
    expect(calendarMoveIso(old.end, old.end, event.end)).toBe(event.end);
    expect(new Date(calendarMoveIso(resized.end, old.end, event.end)).getTime()).toBe(
      resized.end.getTime(),
    );
    if (process.env.TZ === 'America/New_York') {
      // Core recreates the earlier 01:30, even when storage names the later occurrence.
      expect(old.start.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    }
  });

  it('uses existing native Date disambiguation for a changed fold/gap target', () => {
    for (const [month, day, hour] of [
      [10, 1, 1],
      [2, 8, 2],
    ]) {
      const internal = createEvents(
        [
          {
            start: `2026-${String(month! + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T0${hour}:30:00`,
            end: '2026-11-02T12:00:00',
            extendedProps: ev('a'),
          },
        ],
        0,
      )[0]!;
      const callback = toEventWithLocalDates(internal);
      const native = new Date(2026, month!, day!, hour!, 30);
      expect(
        new Date(calendarMoveIso(callback.start, new Date(0), '1970-01-01T00:00:00Z')).getTime(),
      ).toBe(+native);
      if (process.env.TZ === 'America/New_York') {
        expect(callback.start.toISOString()).toBe(
          month === 10 ? '2026-11-01T05:30:00.000Z' : '2026-03-08T07:30:00.000Z',
        );
      }
    }
  });

  it('queries actual native local-midnight callback boundaries across a DST day', async () => {
    fetchJson.mockReset();
    const from = new Date(2026, 2, 8);
    const to = new Date(2026, 2, 9);
    const callbackFrom = toLocalDate(createDate(from, 0));
    const callbackTo = toLocalDate(createDate(to, 0));
    expect(+callbackFrom).toBe(+from);
    expect(+callbackTo).toBe(+to);
    fetchJson.mockResolvedValue({ events: [], from: from.toISOString(), to: to.toISOString() });
    await new CalendarStore().ensure(callbackFrom, callbackTo);
    const url = new URL(String(fetchJson.mock.calls[0]![0]), 'https://fixture.invalid');
    expect(url.searchParams.get('from')).toBe(from.toISOString());
    expect(url.searchParams.get('to')).toBe(to.toISOString());
    if (process.env.TZ === 'America/New_York') expect(+to - +from).toBe(23 * 3600000);
  });
});
