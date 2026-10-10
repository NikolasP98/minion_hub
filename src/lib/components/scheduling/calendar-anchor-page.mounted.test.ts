// @vitest-environment happy-dom
/**
 * HC-016B — the Team calendar PAGE keeps the runway anchor across view
 * switches. The real `/scheduling/calendar` route is mounted with the
 * renderer swapped for `AnchorProbe` (which reports a fixed anchor as it
 * unmounts, the renderer's own `onanchor` contract), so what is under test is
 * exactly the page's plumbing: Calendar → Table → Calendar → Board → Calendar
 * hands the last `onanchor` payload back as `anchor`; a date navigation
 * clears it. `/pos/appointments` carries the same three lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { page } from '$app/state';
import { goto } from '$app/navigation';
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
import { PROBE_ANCHOR } from './__fixtures__/AnchorProbe.svelte';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
vi.mock('$app/navigation', async (original) => {
  const actual = await original<typeof import('$app/navigation')>();
  return { ...actual, goto: vi.fn(async () => {}) };
});
vi.mock('$lib/components/scheduling/BookingCalendar.svelte', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  default: (await import('./__fixtures__/AnchorProbe.svelte')).default,
}));
const { default: Calendar } =
  await import('../../../routes/(app)/scheduling/calendar/+page.svelte');

const calendarScope = calendarWindowScope('org-a', FIXTURE_TIME_ZONE);
const data = (pageView: 'week' | 'table' | 'board' = 'week') =>
  ({
    view: 'week',
    pageView,
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

beforeEach(() => {
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'user-a' },
    permissions: { permissions: ['scheduling:view', 'scheduling:create', 'scheduling:edit'] },
  };
  page.status = 200;
  page.error = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/scheduling/calendar')
        ? Response.json({ calendarScope, bookings: [], tagOptions: [] })
        : new Response(null, { status: 404 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(goto).mockClear();
  page.data = {};
});

const anchorOf = (root: Element) =>
  JSON.parse(root.querySelector('[data-probe]')!.getAttribute('data-anchor')!);

describe('calendar page runway anchor (HC-016B)', () => {
  it('hands the last reported anchor back after switching views twice', async () => {
    const view = render(Calendar, { data: data('week') });
    expect(anchorOf(view.container)).toBeNull();

    // Calendar → Table: the renderer unmounts and reports where it was.
    await view.rerender({ data: data('table') });
    expect(view.container.querySelector('[data-probe]')).toBeNull();
    // Table → Calendar: the page passes that position back.
    await view.rerender({ data: data('week') });
    expect(anchorOf(view.container)).toEqual(PROBE_ANCHOR);

    // Calendar → Board → Calendar: still the same anchor.
    await view.rerender({ data: data('board') });
    await view.rerender({ data: data('week') });
    expect(anchorOf(view.container)).toEqual(PROBE_ANCHOR);
  });

  it('a date navigation invalidates the saved anchor', async () => {
    const view = render(Calendar, { data: data('week') });
    await view.rerender({ data: data('table') });
    await view.rerender({ data: data('week') });
    expect(anchorOf(view.container)).toEqual(PROBE_ANCHOR);

    await fireEvent.click(view.container.querySelector('[data-probe-ondate]')!);
    expect(goto).toHaveBeenCalledWith('?view=week&date=2026-09-15', expect.anything());
    // Cleared synchronously: the runway re-anchors on the new day, and only a
    // later settle/unmount report (the renderer's own) fills it again.
    expect(anchorOf(view.container)).toBeNull();
  });
});
