// @vitest-environment happy-dom
/**
 * HC-014 — every subcolumn axis says what a lane drop can write. Mounts the
 * ACTUAL `/scheduling/calendar` route (mobile-composition seed, day view) once
 * per built-in axis and drives a real pointer sequence from the subject's lane
 * into a foreign lane:
 *   - `staff` / a custom column: a SUPPORTED write — the ghost follows the
 *     pointer and the one PATCH carries the new value (resource / properties).
 *   - `status`, `kind`, `service`, `tags`: VIEW-ONLY — the drag is refused
 *     before any misleading ghost: no ghost ever renders in the foreign lane,
 *     the hovered lane header and the ghost carry the refusal cue, the drop
 *     commits only a time change in the source lane, and the lane headers name
 *     the axis as view only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { page } from '$app/state';
import {
  EVENTS,
  EVENT_TYPES,
  FIXTURE_DAY,
  FIXTURE_TIME_ZONE,
  KINDS,
  RESOURCES,
  TAG_OPTIONS,
} from '../../../../tests/fixtures/mobile-composition/seed';
import { calendarWindowScope } from './calendar-window';
import { DEFAULT_PX_PER_HOUR } from './BookingCalendar.svelte';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
const { default: Calendar } =
  await import('../../../routes/(app)/scheduling/calendar/+page.svelte');

const PROP = '55555555-5555-4555-8555-555555555555';
const SUBJECT = 'r1-0'; // Paciente 1A, resource r1, 08:00–08:45 Lima
const seeded = EVENTS.find((b) => b.id === SUBJECT)!;
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
const cell = (id: string) => ({
  propertyId: PROP,
  recordId: id,
  present: true,
  value: 'a',
  effectiveValue: 'a',
  version: 3,
  updatedAt: null,
});

const calendarScope = calendarWindowScope('org-a', FIXTURE_TIME_ZONE);
/** The seed is single-status / single-tag; give the OTHER r1 booking a
 *  different status and tag so every built-in axis has two lanes. */
const bookings = EVENTS.map((b) =>
  b.id === 'r1-1' ? { ...b, status: 'completed', tags: [TAG_OPTIONS[1] ?? TAG_OPTIONS[0]] } : b,
);
const data = () =>
  ({
    view: 'day',
    pageView: 'day',
    day: FIXTURE_DAY,
    orgTz: FIXTURE_TIME_ZONE,
    calendarScope,
    staff: [],
    kindId: null,
    showInheritedTags: true,
    resources: RESOURCES,
    kinds: KINDS,
    eventTypes: EVENT_TYPES,
    categories: [],
    hours: {},
    tagOptions: TAG_OPTIONS,
    bookings,
  }) as unknown as ComponentProps<typeof Calendar>['data'];

let patches: { url: string; body: Record<string, unknown> }[];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: { permissions: ['scheduling:view', 'scheduling:create', 'scheduling:edit'] },
  };
  page.status = 200;
  page.error = null;
  patches = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/tables/properties/values/query')) {
        const { recordIds } = JSON.parse(String(init?.body)) as { recordIds: string[] };
        return json({
          definitions: [definition],
          values: Object.fromEntries(recordIds.map((id) => [id, { [PROP]: cell(id) }])),
          recordAccess: Object.fromEntries(recordIds.map((id) => [id, { canEdit: true }])),
          canManage: false,
          canEdit: true,
        });
      }
      if (url.startsWith('/api/tables/properties'))
        return json({ definitions: [definition], canManage: false, canEdit: true });
      if (url.startsWith('/api/scheduling/calendar'))
        return json({ calendarScope, bookings: [], tagOptions: [] });
      if (url.startsWith('/api/scheduling/bookings/') && method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init?.body)) });
        return json({ ok: true, cancelled: [], stockWarning: null, booking: null });
      }
      return new Response(null, { status: 404 });
    }),
  );
  // happy-dom lays nothing out: every column is a 100px rect at its index.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement;
    const i =
      this.classList.contains('col') && parent
        ? Array.prototype.indexOf.call(parent.children, this)
        : -1;
    const left = i < 0 ? 0 : i * 100;
    const right = i < 0 ? 0 : left + 100;
    return {
      left,
      right,
      top: 0,
      bottom: 1000,
      x: left,
      y: 0,
      width: right - left,
      height: 1000,
      toJSON: () => ({}),
    } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  page.data = {};
});

function subjectBox(view: RenderResult<typeof Calendar>): HTMLElement {
  const boxes = [...view.container.querySelectorAll<HTMLElement>('.col:not(.is-all) .evt')];
  const box = boxes.find((el) => el.textContent?.includes(seeded.attendeeName!));
  if (!box) throw new Error('subject box not rendered');
  return box;
}
const laneOf = (el: HTMLElement) => Number(el.dataset.lane);
const topOf = (box: HTMLElement) => parseFloat(box.style.top);

async function mountAxis(axis: string) {
  localStorage.setItem('hub-scheduling-calendar-subcolumns', axis);
  const view = render(Calendar, { data: data() });
  await waitFor(() => {
    expect(
      view.container.querySelectorAll('.col:not(.is-all) .head-sub-cell').length,
    ).toBeGreaterThan(1);
  });
  // The subject's lane is settled (custom values loaded) before any gesture.
  await waitFor(() => expect(Number.isNaN(laneOf(subjectBox(view)))).toBe(false));
  if (axis.startsWith('prop:')) await waitFor(() => expect(laneOf(subjectBox(view))).toBe(0));
  return view;
}

/** Press on the subject, cross into a foreign lane one hour lower (pointer
 *  held), return the column so the caller can inspect the in-flight state. */
async function dragToForeignLane(view: RenderResult<typeof Calendar>) {
  const box = subjectBox(view);
  const col = box.closest<HTMLElement>('.col')!;
  const i = Array.prototype.indexOf.call(col.parentElement!.children, col);
  const lanes = col.querySelectorAll('.head-sub-cell').length;
  const target = laneOf(box) === 0 ? 1 : 0;
  const x = i * 100 + ((target + 0.5) / lanes) * 100;
  const y = 300;
  await fireEvent.pointerDown(box.querySelector<HTMLElement>('.evt-in')!, {
    button: 0,
    clientX: i * 100 + 10,
    clientY: y,
  });
  await fireEvent.pointerMove(window, { clientX: x, clientY: y + DEFAULT_PX_PER_HOUR });
  return { col, target, x, y, source: laneOf(box) };
}
const release = (x: number, y: number) =>
  fireEvent.pointerUp(window, { clientX: x, clientY: y + DEFAULT_PX_PER_HOUR });
const hourLater = (iso: string) => new Date(new Date(iso).getTime() + 3_600_000).toISOString();

describe('view-only axes refuse a lane drop before a misleading ghost (HC-014)', () => {
  for (const axis of ['status', 'kind', 'service', 'tags']) {
    it(`${axis}: ghost confined to the source lane, refusal cue, PATCH carries only time + resource`, async () => {
      const view = await mountAxis(axis);
      const before = topOf(subjectBox(view));
      // Every lane header names the axis as view only (accessible name suffix).
      const heads = [...view.container.querySelectorAll<HTMLElement>('.head-sub-cell')];
      expect(heads.length).toBeGreaterThan(1);
      for (const h of heads) expect(h.textContent).toMatch(/view only$/);

      const { col, target, x, y, source } = await dragToForeignLane(view);
      // In flight: the ghost is in the SOURCE lane, never in the foreign one…
      const ghost = col.querySelector<HTMLElement>('.evt-ghost')!;
      expect(ghost).not.toBeNull();
      expect(laneOf(ghost)).toBe(source);
      expect(col.querySelector(`.evt-ghost[data-lane="${target}"]`)).toBeNull();
      // …and the refusal is visible: the hovered lane header, the ghost and the column.
      expect(ghost.classList.contains('is-refused')).toBe(true);
      expect(ghost.textContent).toContain('View only');
      expect(col.querySelectorAll('.head-sub-cell')[target].classList.contains('is-refused')).toBe(
        true,
      );
      expect(col.classList.contains('is-refusing')).toBe(true);

      await release(x, y);
      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0].body).toEqual({
        start: hourLater(seeded.start),
        end: hourLater(seeded.end),
        resourceId: 'r1',
      });
      // Nothing reclassified: same lane, time moved as the ghost showed.
      expect(laneOf(subjectBox(view))).toBe(source);
      expect(topOf(subjectBox(view))).toBe(before + DEFAULT_PX_PER_HOUR);
      expect(col.querySelector('.is-refused')).toBeNull();
    });
  }
});

describe('writable axes follow the pointer and write the new value (HC-014)', () => {
  it('staff: the ghost moves to the foreign lane and the PATCH carries that resource', async () => {
    const view = await mountAxis('staff');
    const heads = [...view.container.querySelectorAll<HTMLElement>('.head-sub-cell')];
    for (const h of heads) expect(h.textContent).not.toMatch(/view only$/);
    const { col, target, x, y } = await dragToForeignLane(view);
    const ghost = col.querySelector<HTMLElement>('.evt-ghost')!;
    expect(laneOf(ghost)).toBe(target);
    expect(ghost.classList.contains('is-refused')).toBe(false);
    expect(col.classList.contains('is-refusing')).toBe(false);
    const targetResource = heads[target].getAttribute('title');
    await release(x, y);
    await waitFor(() => expect(patches).toHaveLength(1));
    const body = patches[0].body as { resourceId: string; properties?: unknown };
    expect(body.resourceId).toBe(RESOURCES.find((r) => r.name === targetResource)!.id);
    expect(body.properties).toBeUndefined();
  });

  it('custom column: the ghost moves to the foreign lane and the PATCH carries the value', async () => {
    const view = await mountAxis(`prop:${PROP}`);
    const { col, target, x, y } = await dragToForeignLane(view);
    expect(laneOf(col.querySelector<HTMLElement>('.evt-ghost')!)).toBe(target);
    await release(x, y);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body.properties).toEqual([
      { propertyId: PROP, recordId: SUBJECT, value: 'b', expectedVersion: 3 },
    ]);
  });
});
