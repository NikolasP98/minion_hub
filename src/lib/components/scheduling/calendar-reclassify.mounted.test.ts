// @vitest-environment happy-dom
/**
 * HC-011E — a reclassifying drag (a drop into another subcolumn of a custom
 * SELECT column) is ONE server command. Mounts the ACTUAL `/scheduling/calendar`
 * route in day view with the mobile-composition seed, one custom column with
 * two options as the subcolumn axis, and a stubbed `fetch`, then drives a real
 * pointer sequence across lanes (happy-dom lays nothing out, so the column
 * rects `beginDrag` measures are stubbed per column) and proves:
 *   1. success → exactly one PATCH carrying `start/end/resourceId` AND the
 *      `properties` write; no `PUT /api/tables/properties/values`; the overlay
 *      paints lane + time together and clears together.
 *   2. the property stage refused → the same single request; nothing moved: the
 *      box returns to its lane and time; the failure toast names the stage.
 *   3. the move stage refused (409 conflicts) → single request; lane and time
 *      both back (the server rolled the value back with the move); the conflict
 *      dialog's "Move anyway" retries with the SAME `properties` — the lane is
 *      never dropped from the retry, and never written on its own.
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

const toastError = vi.fn();
vi.mock('$lib/state/ui/toast.svelte', async (original) => {
  const actual = await original<typeof import('$lib/state/ui/toast.svelte')>();
  return { ...actual, toastError: (...a: unknown[]) => toastError(...a) };
});
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
const VERSION = 3;
const cell = (id: string, value: string) => ({
  propertyId: PROP,
  recordId: id,
  present: true,
  value,
  effectiveValue: value,
  version: VERSION,
  updatedAt: null,
});
/** Every seeded booking holds a value, so the axis has exactly two lanes. */
const bundle = (subjectValue: string, ids: string[]) => ({
  definitions: [definition],
  values: Object.fromEntries(
    ids.map((id) => [id, { [PROP]: cell(id, id === SUBJECT ? subjectValue : 'a') }]),
  ),
  recordAccess: Object.fromEntries(ids.map((id) => [id, { canEdit: true }])),
  canManage: false,
  canEdit: true,
});

const calendarScope = calendarWindowScope('org-a', FIXTURE_TIME_ZONE);
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
    bookings: EVENTS,
  }) as unknown as ComponentProps<typeof Calendar>['data'];

type Hold = { resolve: (r: Response) => void };
interface Net {
  patches: { url: string; body: Record<string, unknown> }[];
  puts: number;
  /** What the server holds for the subject — refetched after every command. */
  serverValue: string;
  outcome: 'ok' | 'property' | 'conflict';
  hold: Hold | null;
}
let net: Net;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  toastError.mockClear();
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: { permissions: ['scheduling:view', 'scheduling:create', 'scheduling:edit'] },
  };
  page.status = 200;
  page.error = null;
  localStorage.setItem('hub-scheduling-calendar-subcolumns', `prop:${PROP}`);
  net = { patches: [], puts: 0, serverValue: 'a', outcome: 'ok', hold: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/tables/properties/values/query')) {
        const { recordIds } = JSON.parse(String(init?.body)) as { recordIds: string[] };
        return json(bundle(net.serverValue, recordIds));
      }
      if (url.startsWith('/api/tables/properties/values')) {
        net.puts += 1;
        return json({ message: 'unexpected standalone write' }, 500);
      }
      if (url.startsWith('/api/tables/properties'))
        return json({ definitions: [definition], canManage: false, canEdit: true });
      if (url.startsWith('/api/scheduling/calendar'))
        return json({ calendarScope, bookings: [], tagOptions: [] });
      if (url.startsWith('/api/scheduling/bookings/') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        net.patches.push({ url, body });
        const answer =
          net.outcome === 'ok'
            ? (() => {
                net.serverValue = 'b';
                return json({ ok: true, cancelled: [], stockWarning: null, booking: null });
              })()
            : net.outcome === 'property'
              ? json(
                  { error: 'property', code: 'version_conflict', message: 'version_conflict' },
                  409,
                )
              : json(
                  {
                    error: 'conflict',
                    message: 'clash',
                    conflicts: [
                      {
                        id: 'r1-1',
                        title: 'Afinamiento facial',
                        start: seeded.start,
                        end: seeded.end,
                        resourceId: 'r1',
                      },
                    ],
                  },
                  409,
                );
        if (net.hold)
          return new Promise<Response>(
            (resolve) => (net.hold = { resolve: () => resolve(answer) }),
          );
        return answer;
      }
      return new Response(null, { status: 404 });
    }),
  );
  // happy-dom lays nothing out: give every column a 100px-wide rect at its
  // index so `beginDrag`'s `colRects` and `subAt` see two 50px lanes per column.
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

/** The subject's box in its RESOURCE column (day view also draws an "All" column). */
function subjectBox(view: RenderResult<typeof Calendar>): HTMLElement {
  const boxes = [...view.container.querySelectorAll<HTMLElement>('.col:not(.is-all) .evt')];
  const box = boxes.find((el) => el.textContent?.includes(seeded.attendeeName!));
  if (!box) throw new Error('subject box not rendered');
  return box;
}
/** The subcolumn index the grid placed the box in (`data-lane` = `Placed.sub`). */
const laneOf = (box: HTMLElement) => Number(box.dataset.lane);
const topOf = (box: HTMLElement) => parseFloat(box.style.top);

async function mountWithLanes() {
  const view = render(Calendar, { data: data() });
  // Two lane heads under every column once the definition and values landed.
  await waitFor(() => {
    expect(
      view.container.querySelectorAll('.col:not(.is-all) .head-sub-cell').length,
    ).toBeGreaterThan(0);
  });
  await waitFor(() => expect(laneOf(subjectBox(view))).toBe(0));
  return view;
}

/** Real pointer sequence: press on the box, cross into the second lane one
 *  hour lower, release. */
async function dragAcrossLane(view: RenderResult<typeof Calendar>) {
  const box = subjectBox(view);
  const col = box.closest<HTMLElement>('.col')!;
  const i = Array.prototype.indexOf.call(col.parentElement!.children, col);
  const handle = box.querySelector<HTMLElement>('.evt-in')!;
  const y = 300;
  await fireEvent.pointerDown(handle, { button: 0, clientX: i * 100 + 10, clientY: y });
  await fireEvent.pointerMove(window, { clientX: i * 100 + 80, clientY: y + DEFAULT_PX_PER_HOUR });
  await fireEvent.pointerUp(window, { clientX: i * 100 + 80, clientY: y + DEFAULT_PX_PER_HOUR });
}

const hourLater = (iso: string) => new Date(new Date(iso).getTime() + 3_600_000).toISOString();
const expectedWrite = { propertyId: PROP, recordId: SUBJECT, value: 'b', expectedVersion: VERSION };

describe('reclassifying drag is one command (HC-011)', () => {
  it('success: one PATCH with time + properties, overlay covers lane and time, both clear together', async () => {
    const view = await mountWithLanes();
    const before = topOf(subjectBox(view));
    net.hold = { resolve: () => {} };

    await dragAcrossLane(view);

    await waitFor(() => expect(net.patches).toHaveLength(1));
    expect(net.patches[0].url).toBe(`/api/scheduling/bookings/${SUBJECT}`);
    expect(net.patches[0].body).toEqual({
      start: hourLater(seeded.start),
      end: hourLater(seeded.end),
      resourceId: 'r1',
      properties: [expectedWrite],
    });
    // In flight: the box already sits in the new lane AT the new time.
    const inFlight = subjectBox(view);
    expect(laneOf(inFlight)).toBe(1);
    expect(topOf(inFlight)).toBe(before + DEFAULT_PX_PER_HOUR);

    net.hold!.resolve(new Response());
    // Settled: the lane comes from the store's re-read of server truth ('b');
    // the time from the page's reload (a no-op here, so the seeded slot).
    await waitFor(() => expect(topOf(subjectBox(view))).toBe(before));
    expect(laneOf(subjectBox(view))).toBe(1);
    expect(net.puts).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(
      (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, i]) => (i as RequestInit)?.method === 'PATCH',
      ),
    ).toHaveLength(1);
  });

  it('property stage refused: one request, nothing moved (lane and time back), toast names the stage', async () => {
    net.outcome = 'property';
    const view = await mountWithLanes();
    const before = topOf(subjectBox(view));

    await dragAcrossLane(view);

    await waitFor(() => expect(net.patches).toHaveLength(1));
    expect(net.patches[0].body).toMatchObject({ properties: [expectedWrite] });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not move the appointment',
        'The custom column value was refused (version_conflict); nothing was changed.',
      ),
    );
    await waitFor(() => expect(laneOf(subjectBox(view))).toBe(0));
    expect(topOf(subjectBox(view))).toBe(before);
    expect(net.puts).toBe(0);
    expect(net.patches).toHaveLength(1);
  });

  it('move stage refused (409 conflicts): lane and time back, dialog retries with the same properties', async () => {
    net.outcome = 'conflict';
    const view = await mountWithLanes();
    const before = topOf(subjectBox(view));

    await dragAcrossLane(view);

    await waitFor(() => expect(net.patches).toHaveLength(1));
    const dialogButton = await view.findByRole('button', { name: 'Move anyway' });
    // Refused as a whole: the box is back in its lane at its time, no toast.
    await waitFor(() => expect(laneOf(subjectBox(view))).toBe(0));
    expect(topOf(subjectBox(view))).toBe(before);
    expect(toastError).not.toHaveBeenCalled();
    expect(net.puts).toBe(0);

    net.outcome = 'ok';
    await fireEvent.click(dialogButton);
    await waitFor(() => expect(net.patches).toHaveLength(2));
    expect(net.patches[1].body).toEqual({
      start: hourLater(seeded.start),
      end: hourLater(seeded.end),
      resourceId: 'r1',
      properties: [expectedWrite],
      overrideConflicts: true,
    });
    await waitFor(() => expect(laneOf(subjectBox(view))).toBe(1));
    expect(net.puts).toBe(0);
  });
});
