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
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  getContact: (ctx: unknown, id: unknown) => mocks.getContact(ctx, id),
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
    startTime: '2026-08-20T09:00:00.000Z',
    endTime: '2026-08-20T09:30:00.000Z',
    resourceId: 'r1',
    eventTypeId: 'e1',
    contactId: 'c1',
    contactName: 'Jane Doe',
    contactPhone: '+51999999999',
    notes: 'Color + cut',
  },
];
const RESOURCES = [
  { id: 'r1', name: 'Front chair', active: true },
  { id: 'r2', name: 'Retired chair', active: false },
];
const EVENT_TYPES = [{ id: 'e1', title: 'Haircut', productId: 'p1' }];
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

// The POS route's fixed preset window: today's server-local midnight..+7d.
const POS_FROM = new Date(NOW.getTime());
POS_FROM.setHours(0, 0, 0, 0);
const POS_TO = new Date(POS_FROM.getTime() + 7 * DAY);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(CTX);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.listBookings.mockResolvedValue(BOOKINGS);
  mocks.listResources.mockResolvedValue(RESOURCES);
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
        'openNew',
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
    expect(result.bookings).toEqual(BOOKINGS);
    expect(result.eventTypes).toEqual(EVENT_TYPES);
    expect(result.accrualSummaries).toEqual(ACCRUALS);
    // Unlike POS, scheduling does NOT pre-filter resources by `active`.
    expect(result.resources).toEqual([
      { id: 'r1', name: 'Front chair' },
      { id: 'r2', name: 'Retired chair' },
    ]);
    expect(result.stockEnabled).toBe(true);
    expect(result.contactId).toBeNull();
    expect(result.openNew).toBe(false);
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
    const url = new URL('http://localhost/scheduling/bookings?contact=c1&new=1');

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
    expect(result.bookings).toEqual(BOOKINGS);
    expect(result.contactId).toBe('c1');
    expect(result.contactName).toBe('Jane Doe');
    expect(result.openNew).toBe(true);
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
  it('returns a POS-shaped key set with a fixed 7-day window and no contact scoping', async () => {
    const { load } = await import('../../pos/appointments/+page.server');
    const depends = vi.fn();

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends,
    } as never)) as Record<string, unknown>;

    // POS has no `contactId`/`contactName`/`openNew` — those are a scheduling-only affordance.
    expect(Object.keys(result).sort()).toEqual(
      ['bookings', 'resources', 'eventTypes', 'stockEnabled', 'accrualSummaries'].sort(),
    );
    expect(depends).toHaveBeenCalledWith('pos:appointments');
    // Fixed today→+7d preset, always applied — not overridable by a query param —
    // with the RBAC-derived maskAttendeePii flag forwarded exactly like scheduling.
    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: POS_FROM,
      to: POS_TO,
      limit: 500,
      maskAttendeePii: false,
    });
    // The primary data contract: bookings pass through unmodified, and
    // eventTypes/accrual data are mapped/forwarded as shipped today.
    expect(result.bookings).toEqual(BOOKINGS);
    expect(result.eventTypes).toEqual(EVENT_TYPES);
    expect(result.accrualSummaries).toEqual(ACCRUALS);
    // POS-only: inactive resources are filtered out before reaching the view.
    expect(result.resources).toEqual([{ id: 'r1', name: 'Front chair' }]);
  });

  it('forwards maskAttendeePii: true when the RBAC decision says to mask attendees', async () => {
    const { load } = await import('../../pos/appointments/+page.server');
    mocks.shouldMaskSensitive.mockResolvedValue(true);

    await load({
      locals: { orgKind: 'business', moduleStates: { stock: true } },
      depends: vi.fn(),
    } as never);

    expect(mocks.listBookings).toHaveBeenCalledWith(CTX, {
      from: POS_FROM,
      to: POS_TO,
      limit: 500,
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
    } as never)) as Record<string, unknown>;

    expect(result.stockEnabled).toBe(true);
  });

  it('defaults stockEnabled to true when moduleStates carries no explicit flag', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    const result = (await load({
      locals: { orgKind: 'business', moduleStates: {} },
      depends: vi.fn(),
    } as never)) as Record<string, unknown>;

    expect(result.stockEnabled).toBe(true);
  });

  it('always attempts the accrual read (unconditional try/catch, no stock-enabled short-circuit)', async () => {
    const { load } = await import('../../pos/appointments/+page.server');

    await load({
      locals: { orgKind: 'business', moduleStates: { stock: false } },
      depends: vi.fn(),
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
