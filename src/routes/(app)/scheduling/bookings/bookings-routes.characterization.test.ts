import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 1 of 2026-08-17-hub-pos-appointments-fork-spec: pins today's behaviour
 * of the two independent implementations (`/scheduling/bookings` and
 * `/pos/appointments`) before Slices 2-3 extract a shared `BookingsView`.
 *
 * Red-state proof summary: the `stockEnabled` assertion for `/pos/appointments`
 * was first written expecting `effectiveModuleEnabled`-style gating (`false`
 * for a personal-kind org with stock toggled on) and failed, because the POS
 * load actually reads `locals.moduleStates?.stock ?? true` directly — a real
 * drift from the scheduling side, not a copy-paste artifact. The assertion
 * below pins what ships today, not what the two sides "should" do (fixing the
 * drift is out of scope per the spec's personal-org kind-leak carve-out).
 */

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  listBookings: vi.fn(),
  listResources: vi.fn(),
  listEventTypes: vi.fn(),
  getResourceSchedule: vi.fn(),
  listPendingSchedulingLines: vi.fn(),
  listTicketsForCalendar: vi.fn(),
  getContact: vi.fn(),
  accrualSummaryForSources: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (locals: unknown) => mocks.getCoreCtx(locals),
}));
vi.mock('$server/services/rbac.service', () => ({
  shouldMaskSensitive: (locals: unknown, module: unknown) =>
    mocks.shouldMaskSensitive(locals, module),
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  listBookings: (ctx: unknown, opts: unknown) => mocks.listBookings(ctx, opts),
}));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: (ctx: unknown) => mocks.listResources(ctx),
  listEventTypes: (ctx: unknown) => mocks.listEventTypes(ctx),
  // Event kinds feed the calendar's `kind` colour source; none in this fixture.
  listEventKinds: async () => [],
  getResourceSchedule: (ctx: unknown, id: unknown) => mocks.getResourceSchedule(ctx, id),
}));
vi.mock('$server/services/finance-products.service', () => ({
  // Product-category colour source (`categoryColor`); no products in this fixture.
  categoryColorsForProducts: async () => new Map<string, string>(),
}));
vi.mock('$server/services/pos-categories.service', () => ({
  // The `category` colour source's VALUE list (previewed in the colour picker);
  // none in this fixture.
  listProductCategories: async () => [],
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  listPendingSchedulingLines: (ctx: unknown, opts: unknown) =>
    mocks.listPendingSchedulingLines(ctx, opts),
  listTicketsForCalendar: (ctx: unknown, window: unknown) =>
    mocks.listTicketsForCalendar(ctx, window),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  getContact: (ctx: unknown, id: unknown) => mocks.getContact(ctx, id),
  listTags: async () => [],
}));
vi.mock('$server/services/tag-links.service', () => ({
  getTagLinks: async () => new Map(),
  getContactTagsBulk: async () => new Map(),
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  accrualSummaryForSources: (ctx: unknown, source: unknown, ids: unknown) =>
    mocks.accrualSummaryForSources(ctx, source, ids),
}));

const DAY = 86_400_000;
const NOW = new Date('2026-08-18T12:00:00.000Z');

const CTX = { db: {}, tenantId: 'org-1' };
const BOOKINGS = [
  {
    id: 'b1',
    status: 'accepted',
    startTime: new Date('2026-08-20T09:00:00.000Z'),
    endTime: new Date('2026-08-20T09:30:00.000Z'),
    resourceId: 'r1',
    eventTypeId: 'e1',
    contactId: 'c1',
    contactName: 'Jane Doe',
    contactPhone: '+51999999999',
    notes: 'Color + cut',
  },
];
// loadBookingsView (spec S6) maps every booking through a batched invoice-id
// lookup and merges `invoiceLabel` — null here since none of the fixture rows
// carry an invoiceId, and the lookup is skipped entirely in that case.
const BOOKINGS_WITH_INVOICE_LABEL = BOOKINGS.map((b) => ({ ...b, invoiceLabel: null }));
const RESOURCES = [
  { id: 'r1', name: 'Front chair', active: true, color: '#abcdef' },
  { id: 'r2', name: 'Retired chair', active: false, color: null },
];
const EVENT_TYPES = [{ id: 'e1', title: 'Haircut', productId: 'p1', active: true, length: 30 }];
const ACCRUALS = [
  {
    sourceId: 'b1',
    open: 1,
    realized: 0,
    released: 0,
    estValue: 10,
    realizedValue: 0,
    realizedEntryId: null,
  },
];

// The scheduling route's default (no ?contact=) window: now-30d..now+90d.
const SCHEDULING_FROM = new Date(NOW.getTime() - 30 * DAY);
const SCHEDULING_TO = new Date(NOW.getTime() + 90 * DAY);

/**
 * The POS route's window is now VIEW-DERIVED, not a fixed preset: it resolves
 * `?view`/`?date` through `calendarLoadWindow` in the org timezone, exactly
 * like /scheduling/calendar, because both calendars render the same
 * `BookingCalendar` and must agree on the window for the same query.
 *
 * For workweek/week the DATA-LOAD window is wider than the rendered view — 4
 * ISO weeks anchored one week behind the focused date (batch 5, infinite
 * scrolling: the SSR load already covers a week ahead/behind on first
 * render). With no query params, `NOW` (2026-08-18T12:00Z = Tue 18 Aug in
 * America/Lima, the fallback tz when no active resource carries one) and the
 * default `workweek` view give week W = Mon 17 Aug .. Fri 21 Aug, so the load
 * range is W-1..W+2 = Mon 10 Aug .. Sun 6 Sep, resolved in Lima (UTC-5) as a
 * window INCLUSIVE of the last day — `to` is the last instant before the
 * start of Mon 7 Sep, because `listBookings` compares `startTime` with `lte`
 * and a bare midnight bound would drop every booking in the final column.
 * Day view (the other spec below) is unaffected — its load range is still
 * just the one day.
 */
const POS_FROM = new Date('2026-08-10T05:00:00.000Z');
const POS_TO = new Date('2026-09-07T04:59:59.999Z');
/** No query params — the loader falls back to the default view and today. */
const POS_URL = () => new URL('http://localhost/pos/appointments');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(CTX);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.listBookings.mockResolvedValue(BOOKINGS);
  mocks.listResources.mockResolvedValue(RESOURCES);
  mocks.listPendingSchedulingLines.mockResolvedValue([]);
  mocks.listTicketsForCalendar.mockResolvedValue([]);
  mocks.getResourceSchedule.mockResolvedValue({
    scheduleId: 's1',
    timezone: 'America/Lima',
    rules: [
      { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '13:00', date: null },
      { days: [1, 2, 3, 4, 5], startTime: '14:00', endTime: '18:00', date: null },
      { days: [6], startTime: '10:00', endTime: '12:00', date: '2026-08-22' }, // override: ignored
    ],
  });
  mocks.listEventTypes.mockResolvedValue(EVENT_TYPES);
  mocks.getContact.mockResolvedValue(null);
  mocks.accrualSummaryForSources.mockResolvedValue(ACCRUALS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/scheduling/bookings load — pinned key set', () => {
  it('returns the full key set with default filters + effectiveModuleEnabled stock gate', async () => {
    const { load } = await import('./+page.server');
    const depends = vi.fn();
    const url = new URL('http://localhost/scheduling/bookings');
    const locals = { orgKind: 'business', moduleStates: { stock: true } };

    const result = (await load({ locals, depends, url } as never)) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual(
      [
        'bookings',
        'resources',
        'eventTypes',
        'stockEnabled',
        'contactId',
        'contactName',
        'accrualSummaries',
      ].sort(),
    );
    expect(depends).toHaveBeenCalledWith('scheduling:data');
    // No ?contact= — the default rolling window is now-30d..now+90d, exactly, with
    // the RBAC-derived maskAttendeePii flag forwarded and no contact filter.
    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: SCHEDULING_FROM,
      to: SCHEDULING_TO,
      limit: 500,
      maskAttendeePii: false,
    });
    // The primary data contract: bookings pass through unmodified, and
    // eventTypes/accrual data are mapped/forwarded as shipped today.
    expect(result.bookings).toEqual(BOOKINGS_WITH_INVOICE_LABEL);
    expect(result.eventTypes).toEqual(EVENT_TYPES.map((e) => ({ ...e, kindId: null })));
    expect(result.accrualSummaries).toEqual(ACCRUALS);
    // Unlike POS, scheduling does NOT pre-filter resources by `active`.
    expect(result.resources).toEqual([
      { id: 'r1', name: 'Front chair' },
      { id: 'r2', name: 'Retired chair' },
    ]);
    expect(result.stockEnabled).toBe(true);
    expect(result.contactId).toBeNull();
  });

  it('forwards maskAttendeePii: true when the RBAC decision says to mask attendees', async () => {
    const { load } = await import('./+page.server');
    mocks.shouldMaskSensitive.mockResolvedValue(true);
    const url = new URL('http://localhost/scheduling/bookings');

    await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends: vi.fn(),
      url,
    } as never);

    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: SCHEDULING_FROM,
      to: SCHEDULING_TO,
      limit: 500,
      maskAttendeePii: true,
    });
  });

  it('switches to a contact-scoped, unwindowed query when ?contact= is present', async () => {
    const { load } = await import('./+page.server');
    mocks.getContact.mockResolvedValue({ contact: { displayName: 'Jane Doe' } });
    const url = new URL('http://localhost/scheduling/bookings?contact=c1');

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: {} },
      depends: vi.fn(),
      url,
    } as never)) as Record<string, unknown>;

    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      crmContactId: 'c1',
      limit: 500,
      maskAttendeePii: false,
    });
    expect(result.bookings).toEqual(BOOKINGS_WITH_INVOICE_LABEL);
    expect(result.contactId).toBe('c1');
    expect(result.contactName).toBe('Jane Doe');
  });

  it('redirects the legacy ?new=1 deep link to the in-page booking form', async () => {
    const { load } = await import('./+page.server');
    const url = new URL('http://localhost/scheduling/bookings?contact=c1&new=1');
    await expect(
      load({ locals: { orgKind: 'business', moduleStates: {} }, depends: vi.fn(), url } as never),
    ).rejects.toMatchObject({ status: 302, location: '/scheduling/bookings/new?contact=c1' });
  });

  it('skips the stock-accrual read entirely when stock is not effectively enabled (kind-hidden or toggled off)', async () => {
    const { load } = await import('./+page.server');
    const url = new URL('http://localhost/scheduling/bookings');

    const result = (await load({
      locals: { orgKind: 'personal', moduleStates: { stock: true } },
      depends: vi.fn(),
      url,
    } as never)) as Record<string, unknown>;

    expect(mocks.accrualSummaryForSources).not.toHaveBeenCalled();
    expect(result.stockEnabled).toBe(false);
    expect(result.accrualSummaries).toEqual([]);
  });
});

describe('/pos/appointments load — pinned key set', () => {
  it('returns a POS-shaped key set with a view-derived window and no contact scoping', async () => {
    const { load } = await import('../../pos/appointments/+page.server');
    const depends = vi.fn();

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends,
      url: POS_URL(),
    } as never)) as Record<string, unknown>;

    // POS has no `contactId`/`contactName`/`openNew` — those are a scheduling-only
    // affordance. It DOES now carry `day`/`view`: the page is a calendar whose
    // focused date and view live in the URL, so the load must echo what it
    // resolved (the old 732-line fork had neither, because its window was fixed).
    expect(Object.keys(result).sort()).toEqual(
      [
        'bookings',
        'resources',
        'eventTypes',
        'stockEnabled',
        'accrualSummaries',
        'day',
        'view',
        'hours',
        'pending',
        'invoices',
        'tagOptions',
        'kinds',
        'categories',
      ].sort(),
    );
    expect(depends).toHaveBeenCalledWith('pos:appointments');
    expect(result.day).toBe('2026-08-18');
    expect(result.view).toBe('workweek');
    // Off-hours envelope per resource: weekly rules collapse to [earliest open,
    // latest close] per weekday; single-date overrides are ignored.
    expect(result.hours).toEqual({
      r1: { 1: [540, 1080], 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080] },
    });
    // The old pin — a fixed today→+7d preset not overridable by a query param —
    // no longer describes this route: it shares `BookingCalendar` with
    // /scheduling/calendar, so the window is derived from ?view/?date in the org
    // timezone. `limit` rose 500 → 2000 with it, because a week view of a busy
    // clinic can exceed 500 rows. The maskAttendeePii forwarding is unchanged.
    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: POS_FROM,
      to: POS_TO,
      limit: 2000,
      maskAttendeePii: false,
    });
    // The primary data contract. Bookings are no longer passed through verbatim:
    // they are projected to `BookingCalendar`'s compact shape with ISO instants.
    // Unlike scheduling, POS still does NOT go through loadBookingsView
    // (spec S6's invoice-label batching never touches this route).
    expect(result.bookings).toEqual([
      {
        id: 'b1',
        resourceId: 'r1',
        eventTypeId: 'e1',
        start: '2026-08-20T09:00:00.000Z',
        end: '2026-08-20T09:30:00.000Z',
        status: 'accepted',
        attendeeName: undefined,
        attendeePhone: undefined,
        partyId: null,
        productId: null,
        notes: 'Color + cut',
        checkup: false,
        // Merged-visit id (`metadata.groupId`) — null for an ordinary booking.
        groupId: null,
        // Merged-visit order (`metadata.groupSeq`) — null for an ordinary booking.
        groupSeq: null,
        groupLength: null,
        tags: [],
        kindId: null,
        categoryColor: null,
      },
    ]);
    expect(result.eventTypes).toEqual(EVENT_TYPES);
    expect(result.accrualSummaries).toEqual(ACCRUALS);
    // POS-only: inactive resources are filtered out before reaching the view.
    // `color` rides along now — the calendar tints each staff column with it.
    expect(result.resources).toEqual([{ id: 'r1', name: 'Front chair', color: '#abcdef' }]);
  });

  it('leaves a resource with no schedule out of `hours` (unknown, not closed)', async () => {
    const { load } = await import('../../pos/appointments/+page.server');
    mocks.getResourceSchedule.mockResolvedValue(null);

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends: vi.fn(),
      url: POS_URL(),
    } as never)) as Record<string, unknown>;

    expect(result.hours).toEqual({});
  });

  it('honours ?view and ?date, resolving the window in the org timezone', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends: vi.fn(),
      url: new URL('http://localhost/pos/appointments?view=day&date=2026-09-01'),
    } as never)) as Record<string, unknown>;

    expect(result.view).toBe('day');
    expect(result.day).toBe('2026-09-01');
    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: new Date('2026-09-01T05:00:00.000Z'),
      to: new Date('2026-09-02T04:59:59.999Z'),
      limit: 2000,
      maskAttendeePii: false,
    });
  });

  it('forwards maskAttendeePii: true when the RBAC decision says to mask attendees', async () => {
    const { load } = await import('../../pos/appointments/+page.server');
    mocks.shouldMaskSensitive.mockResolvedValue(true);

    await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends: vi.fn(),
      url: POS_URL(),
    } as never);

    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: POS_FROM,
      to: POS_TO,
      limit: 2000,
      maskAttendeePii: true,
    });
  });

  it('reads stockEnabled straight off moduleStates — NOT effectiveModuleEnabled (drift vs scheduling, pinned verbatim)', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    // A personal-kind org with stock explicitly enabled: scheduling's
    // effectiveModuleEnabled would say `false` (kind-hidden); POS says `true`
    // because it never consults orgKind at all. This is the fork's own drift,
    // not something this characterization suite should "fix".
    const result = (await load({
      locals: { orgKind: 'personal', moduleStates: { stock: true } },
      depends: vi.fn(),
      url: POS_URL(),
    } as never)) as Record<string, unknown>;

    expect(result.stockEnabled).toBe(true);
  });

  it('defaults stockEnabled to true when moduleStates carries no explicit flag', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: {} },
      depends: vi.fn(),
      url: POS_URL(),
    } as never)) as Record<string, unknown>;

    expect(result.stockEnabled).toBe(true);
  });

  it('always attempts the accrual read (unconditional try/catch, no stock-enabled short-circuit)', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    await load({
      locals: { orgKind: 'business', moduleStates: { stock: false } },
      depends: vi.fn(),
      url: POS_URL(),
    } as never);

    expect(mocks.accrualSummaryForSources).toHaveBeenCalledWith(CTX, 'booking', ['b1']);
  });
});

describe('route-design-manifest + route-access-registry — pinned per-route contract', () => {
  it('/scheduling/bookings: collection archetype, region scroll, scheduling:view policy', async () => {
    const { routeDesignMeta } = await import('$lib/routes/route-design-manifest');
    const meta = routeDesignMeta('/scheduling/bookings') as
      { kind: string; archetype?: string; scroll?: string; accessPolicyId?: string } | undefined;
    expect(meta?.kind).toBe('screen');
    expect(meta?.archetype).toBe('collection');
    expect(meta?.scroll).toBe('region');
    expect(meta?.accessPolicyId).toBe('permission:scheduling:view');
  });

  it('/pos/appointments: manifest still says workspace-editor even though the page renders a collection shell (drift for Slice 3/4 §4.2 trap 3)', async () => {
    const { routeDesignMeta } = await import('$lib/routes/route-design-manifest');
    const meta = routeDesignMeta('/pos/appointments') as
      { kind: string; archetype?: string; scroll?: string; accessPolicyId?: string } | undefined;
    expect(meta?.kind).toBe('screen');
    expect(meta?.archetype).toBe('workspace-editor');
    expect(meta?.scroll).toBe('region');
    // Own RBAC entry (route-access-registry MODULE_SUBRESOURCES `pos.appointments`),
    // NOT scheduling's — R1: RBAC is not derived from the availability manifest.
    expect(meta?.accessPolicyId).toBe('permission:pos.appointments:view');
  });

  it('route-access-registry keeps a standalone pos.appointments entry distinct from scheduling', async () => {
    const { MODULE_SUBRESOURCES } = await import('$lib/routes/route-access-registry');
    const posSub = MODULE_SUBRESOURCES.pos?.find((s) => s.key === 'pos.appointments');
    expect(posSub).toMatchObject({ route: '/pos/appointments' });
    const schedulingSub = MODULE_SUBRESOURCES.scheduling?.find(
      (s) => s.route === '/scheduling/bookings',
    );
    expect(schedulingSub).toBeUndefined();
  });
});

describe('availability manifest — composite gate (§R1: /pos/appointments requires BOTH pos and scheduling)', () => {
  it('is not blocked when both pos and scheduling are enabled', async () => {
    const { isAppRouteBlocked } = await import('$lib/modules/route-guard');
    expect(isAppRouteBlocked('/pos/appointments', { kind: 'business', moduleStates: {} })).toBe(
      false,
    );
  });

  it('is blocked (404) when scheduling is disabled, even though pos is enabled', async () => {
    const { isAppRouteBlocked } = await import('$lib/modules/route-guard');
    expect(
      isAppRouteBlocked('/pos/appointments', {
        kind: 'business',
        moduleStates: { pos: true, scheduling: false },
      }),
    ).toBe(true);
  });

  it('is blocked (404) when pos is disabled, even though scheduling is enabled', async () => {
    const { isAppRouteBlocked } = await import('$lib/modules/route-guard');
    expect(
      isAppRouteBlocked('/pos/appointments', {
        kind: 'business',
        moduleStates: { pos: false, scheduling: true },
      }),
    ).toBe(true);
  });

  it('/scheduling/bookings has no composite dependency on pos', async () => {
    const { isAppRouteBlocked } = await import('$lib/modules/route-guard');
    expect(
      isAppRouteBlocked('/scheduling/bookings', {
        kind: 'business',
        moduleStates: { pos: false, scheduling: true },
      }),
    ).toBe(false);
  });
});
