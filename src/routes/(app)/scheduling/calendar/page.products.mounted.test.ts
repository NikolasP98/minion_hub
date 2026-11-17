// @vitest-environment happy-dom
/**
 * Spec 126 — the scheduling calendar page keeps its booking and tag-only view: its window requests carry
 * the version header, its answers are strictly decoded before the cache, and the rows it renders hold no
 * money, sold or stock facet (they are `not_in_slice`, the overlay `denied`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { page } from '$app/state';
import { calendarWindowScope } from '$lib/components/scheduling/calendar-window';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } =
    await import('$lib/components/scheduling/__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
vi.mock('$app/navigation', async (original) => ({
  ...(await original<typeof import('$app/navigation')>()),
  goto: vi.fn(async () => {}),
}));
vi.mock('$lib/components/scheduling/BookingCalendar.svelte', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  default: (await import('$lib/components/scheduling/__fixtures__/PosCalendarProbe.svelte'))
    .default,
}));
const { default: Calendar } = await import('./PageBody.svelte');

const TZ = 'America/Lima';
const scope = calendarWindowScope('org-a', TZ);
const notInSlice = { state: 'unavailable', reason: 'not_in_slice' };
const row = (id: string) => ({
  id,
  resourceId: 'r1',
  eventTypeId: 'et1',
  start: '2026-09-08T14:00:00.000Z',
  end: '2026-09-08T15:00:00.000Z',
  status: 'completed',
  attendeeName: 'Ana',
  productFacets: { version: 1, sold: notInSlice, payment: notInSlice, stock: notInSlice },
});
const data = () =>
  ({
    view: 'week',
    pageView: 'week',
    day: '2026-09-08',
    orgTz: TZ,
    calendarScope: scope,
    staff: [],
    kindId: null,
    showInheritedTags: true,
    resources: [{ id: 'r1', name: 'Leiva', color: null }],
    kinds: [],
    eventTypes: [],
    categories: [],
    hours: {},
    tagOptions: [],
    productProjectionVersion: 1,
    ticketOverlay: { state: 'denied' },
    bookings: [row('A')],
  }) as unknown as ComponentProps<typeof Calendar>['data'];

let calls: (string | null)[];
let answer: unknown;
beforeEach(() => {
  calls = [];
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'u' },
    permissions: { permissions: ['scheduling:view', 'scheduling:edit'] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('/api/scheduling/calendar'))
        return new Response(null, { status: 404 });
      calls.push(new Headers(init?.headers).get('X-Minion-Booking-Products-Version'));
      if (answer === 409) return Response.json({ error: 'refresh_required' }, { status: 409 });
      // one distinct row per requested week (the cache prefetches neighbours)
      const from = new URL(String(input), 'http://x').searchParams.get('from');
      const body = answer as { bookings: { id: string }[] };
      return Response.json({
        ...body,
        bookings: body.bookings.map((b) => ({
          ...b,
          id: b.id === 'LEGACY' ? b.id : `${b.id}-${from}`,
        })),
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  page.data = {};
});

const scroll = async (view: { container: HTMLElement }) => {
  await fireEvent.click(view.container.querySelector('[data-range]')!);
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
};

describe('scheduling calendar page window (spec 126 T023)', () => {
  it('sends the version header and caches only a strictly decoded, money-free projection', async () => {
    answer = {
      calendarScope: scope,
      productProjectionVersion: 1,
      bookings: [
        { ...row('NEXT'), start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T15:00:00.000Z' },
      ],
      tagOptions: [],
      ticketOverlay: { state: 'denied' },
    };
    const view = render(Calendar, { data: data() });
    await scroll(view);
    expect(calls.every((v) => v === '1')).toBe(true);
    await waitFor(() => expect(view.container.querySelector('[data-b^="NEXT"]')).not.toBeNull());
    // nothing money-ish is rendered for a not_in_slice row
    expect(view.container.textContent).not.toMatch(/PEN|S\/|paid|Charge|post/i);
  });

  it.each([
    [
      'an old protocol (no version)',
      { calendarScope: scope, bookings: [row('LEGACY')], tagOptions: [] },
    ],
    [
      'legacy money namespaces',
      {
        calendarScope: scope,
        productProjectionVersion: 1,
        bookings: [row('LEGACY')],
        tagOptions: [],
        invoices: [],
        accrualSummaries: [],
      },
    ],
    ['HTTP 409 refresh_required', 409],
  ])('refuses %s: nothing of it is cached', async (_n, body) => {
    answer = body;
    const view = render(Calendar, { data: data() });
    await scroll(view);
    expect(view.container.querySelector('[data-b="LEGACY"]')).toBeNull();
    expect(view.container.querySelector('[data-b="A"]')).not.toBeNull(); // the seeded week stays
  });
});
