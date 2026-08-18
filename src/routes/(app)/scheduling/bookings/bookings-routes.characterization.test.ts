import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 1 of 2026-08-17-hub-pos-appointments-fork-spec: pins today's behaviour
 * of the two independent implementations (`/scheduling/bookings` and
 * `/pos/appointments`) before Slices 2-3 extract a shared `BookingsView`.
 *
 * Red-state proof (run once, then reverted — see PR body): the `stockEnabled`
 * assertion for `/pos/appointments` was first written expecting
 * `effectiveModuleEnabled`-style gating (`false` for a personal-kind org with
 * stock toggled on) and failed, because the POS load actually reads
 * `locals.moduleStates?.stock ?? true` directly — a real drift from the
 * scheduling side, not a copy-paste artifact. The assertion below pins what
 * ships today, not what the two sides "should" do (fixing the drift is out of
 * scope per the spec's personal-org kind-leak carve-out).
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
  shouldMaskSensitive: (locals: unknown, module: unknown) => mocks.shouldMaskSensitive(locals, module),
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

const CTX = { db: {}, tenantId: 'org-1' };
const BOOKINGS = [{ id: 'b1', status: 'accepted' }];
const RESOURCES = [
  { id: 'r1', name: 'Front chair', active: true },
  { id: 'r2', name: 'Retired chair', active: false },
];
const EVENT_TYPES = [{ id: 'e1', title: 'Haircut', productId: 'p1' }];
const ACCRUALS = [{ sourceId: 'b1', open: 1, realized: 0, released: 0, estValue: 10, realizedValue: 0, realizedEntryId: null }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(CTX);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.listBookings.mockResolvedValue(BOOKINGS);
  mocks.listResources.mockResolvedValue(RESOURCES);
  mocks.listEventTypes.mockResolvedValue(EVENT_TYPES);
  mocks.getContact.mockResolvedValue(null);
  mocks.accrualSummaryForSources.mockResolvedValue(ACCRUALS);
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
    // No ?contact= — the default rolling window is applied, not a contact filter.
    expect(mocks.listBookings).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ from: expect.any(Date), to: expect.any(Date), limit: 500 }),
    );
    expect(mocks.listBookings.mock.calls[0][1]).not.toHaveProperty('crmContactId');
    // Unlike POS, scheduling does NOT pre-filter resources by `active`.
    expect(result.resources).toEqual([{ id: 'r1', name: 'Front chair' }, { id: 'r2', name: 'Retired chair' }]);
    expect(result.stockEnabled).toBe(true);
    expect(result.contactId).toBeNull();
    expect(result.openNew).toBe(false);
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

    expect(mocks.listBookings).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ crmContactId: 'c1', limit: 500 }),
    );
    expect(mocks.listBookings.mock.calls[0][1]).not.toHaveProperty('from');
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
    // Fixed today→+7d preset, always applied — not overridable by a query param.
    const opts = mocks.listBookings.mock.calls[0][1];
    expect(opts.limit).toBe(500);
    expect(opts.to.getTime() - opts.from.getTime()).toBe(7 * 86_400_000);
    expect(opts.from.getHours()).toBe(0);
    // POS-only: inactive resources are filtered out before reaching the view.
    expect(result.resources).toEqual([{ id: 'r1', name: 'Front chair' }]);
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

    await load({ locals: { orgKind: 'business', moduleStates: { stock: false } }, depends: vi.fn() } as never);

    expect(mocks.accrualSummaryForSources).toHaveBeenCalledWith(CTX, 'booking', ['b1']);
  });
});

describe('route-design-manifest + route-access-registry — pinned per-route contract', () => {
  it('/scheduling/bookings: collection archetype, region scroll, scheduling:view policy', async () => {
    const { routeDesignMeta } = await import('$lib/routes/route-design-manifest');
    const meta = routeDesignMeta('/scheduling/bookings') as
      | { kind: string; archetype?: string; scroll?: string; accessPolicyId?: string }
      | undefined;
    expect(meta?.kind).toBe('screen');
    expect(meta?.archetype).toBe('collection');
    expect(meta?.scroll).toBe('region');
    expect(meta?.accessPolicyId).toBe('permission:scheduling:view');
  });

  it('/pos/appointments: manifest still says workspace-editor even though the page renders a collection shell (drift for Slice 3/4 §4.2 trap 3)', async () => {
    const { routeDesignMeta } = await import('$lib/routes/route-design-manifest');
    const meta = routeDesignMeta('/pos/appointments') as
      | { kind: string; archetype?: string; scroll?: string; accessPolicyId?: string }
      | undefined;
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
    const schedulingSub = MODULE_SUBRESOURCES.scheduling?.find((s) => s.route === '/scheduling/bookings');
    expect(schedulingSub).toBeUndefined();
  });
});

describe('availability manifest — composite gate (§R1: /pos/appointments requires BOTH pos and scheduling)', () => {
  it('is not blocked when both pos and scheduling are enabled', async () => {
    const { isAppRouteBlocked } = await import('$lib/modules/route-guard');
    expect(
      isAppRouteBlocked('/pos/appointments', { kind: 'business', moduleStates: {} }),
    ).toBe(false);
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
