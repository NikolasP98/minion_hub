import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  allowed: true,
  types: [] as Array<Record<string, unknown>>,
  resources: [] as Array<Record<string, unknown>>,
  releases: [] as Array<Record<string, unknown>>,
  slots: vi.fn(),
  notes: vi.fn(),
}));
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));
vi.mock('$server/services/scheduling.service', () => ({
  listEventTypes: async () => fixture.types,
  listResources: async () => fixture.resources,
}));
vi.mock('$server/services/scheduling-slots.service', () => ({
  getSlotsForEventType: fixture.slots,
}));
vi.mock('$server/services/releases/releases.service', () => ({ listReleases: fixture.notes }));
vi.mock('../../routes/api/gateway/_shared/action-auth', () => ({
  requireAssistantCapability: async (
    _locals: unknown,
    _url: URL,
    module: string,
    action: string,
  ) => {
    if (!fixture.allowed) throw Object.assign(new Error('denied'), { status: 403 });
    expect([module, action]).toEqual(['scheduling', 'view']);
    return { ctx: { tenantId: 'fixture-org' } };
  },
}));
vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: async () => {
    if (!fixture.allowed) throw Object.assign(new Error('assignment denied'), { status: 403 });
    return { orgId: 'fixture-org', principalId: 'fixture-owner' };
  },
}));
import { GET as bookingOptions } from '../../routes/api/gateway/query/booking-options/+server';
import { GET as releases } from '../../routes/api/gateway/query/releases/+server';
const event = (params = '') =>
  ({ locals: {}, url: new URL('https://fixture.invalid/?' + params) }) as never;
const type = (id = 'service', patch = {}) => ({
  id,
  orgId: 'fixture-org',
  active: true,
  productId: 'product',
  title: 'Fixture Service',
  length: 60,
  price: 20,
  currency: 'PEN',
  resourceIds: ['staff'],
  ...patch,
});
const resource = (id = 'staff', patch = {}) => ({
  id,
  orgId: 'fixture-org',
  active: true,
  name: 'Fixture Staff',
  timezone: 'America/Lima',
  email: 'hidden@example.invalid',
  profileId: 'hidden-profile',
  ...patch,
});
beforeEach(() => {
  vi.clearAllMocks();
  fixture.allowed = true;
  fixture.types = [type()];
  fixture.resources = [resource()];
  fixture.slots.mockResolvedValue({
    slots: [
      {
        start: new Date('2030-01-10T15:00:00Z'),
        end: new Date('2030-01-10T16:00:00Z'),
        resourceIds: ['staff', 'foreign'],
      },
    ],
  });
  fixture.releases = [
    {
      version: 'hub-v2030.01.10',
      releasedAt: '2030-01-10T00:00:00Z',
      sections: { Fixed: { assistant: ['A fixture change'] } },
      prs: [
        { number: 1, title: 'Fixture', url: 'https://github.com/NikolasP98/minion_hub/pull/1' },
      ],
      secret: 'not-projected',
    },
  ];
  fixture.notes.mockImplementation(async () => fixture.releases);
});
describe('typed booking reference and slot discovery', () => {
  it('returns active scoped references without staff PII or unrelated metadata', async () => {
    fixture.types.push(
      type('foreign', { orgId: 'foreign-org' }),
      type('inactive', { active: false }),
    );
    fixture.resources.push(
      resource('inactive', { active: false }),
      resource('foreign', { orgId: 'foreign-org' }),
    );
    const body = await (await bookingOptions(event())).json();
    expect(body.eventTypes).toEqual([
      {
        eventTypeId: 'service',
        productId: 'product',
        title: 'Fixture Service',
        lengthMinutes: 60,
        price: 20,
        currency: 'PEN',
        resourceIds: ['staff'],
      },
    ]);
    expect(body.resources).toEqual([
      { resourceId: 'staff', name: 'Fixture Staff', timezone: 'America/Lima' },
    ]);
    expect(body.availability).toBe('at_read_not_reserved');
    expect(fixture.slots).not.toHaveBeenCalled();
  });
  it('uses business-local day bounds and returns only known eligible slot resources', async () => {
    const body = await (await bookingOptions(event('eventTypeId=service&date=2030-01-10'))).json();
    expect(fixture.slots).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'fixture-org' }),
      'service',
      new Date('2030-01-10T05:00:00Z'),
      new Date('2030-01-11T05:00:00Z'),
      { pinnedResourceId: undefined },
    );
    expect(body.slots).toEqual([
      {
        start: '2030-01-10T15:00:00.000Z',
        end: '2030-01-10T16:00:00.000Z',
        resourceIds: ['staff'],
      },
    ]);
  });
  it('discloses capped discovery and does not claim complete references', async () => {
    fixture.types.push(type('second'));
    const body = await (await bookingOptions(event('limit=1'))).json();
    expect(body.coverage.eventTypes).toEqual({ total: 2, returned: 1, truncated: true });
  });
  it.each([
    'date=2030-01-10',
    'eventTypeId=service&date=2030-02-31',
    'eventTypeId=service&date=',
    'resourceId=',
    'limit=101',
  ])('rejects invalid inputs %s before slot effects', async (params) => {
    await expect(bookingOptions(event(params))).rejects.toMatchObject({ status: 400 });
    expect(fixture.slots).not.toHaveBeenCalled();
  });
  it.each(['eventTypeId=foreign', 'resourceId=foreign'])(
    'does not reveal foreign references %s',
    async (params) => {
      await expect(bookingOptions(event(params))).rejects.toMatchObject({ status: 404 });
    },
  );
  it('denies before discovery when authority fails', async () => {
    fixture.allowed = false;
    await expect(bookingOptions(event())).rejects.toMatchObject({ status: 403 });
    expect(fixture.slots).not.toHaveBeenCalled();
  });
});
describe('on-demand Minion release notes', () => {
  it('projects only Hub content, source identity and safe PR links', async () => {
    const body = await (await releases(event())).json();
    expect(body).toMatchObject({
      product: 'Minion Hub',
      source: 'hub_app_releases',
      installedGatewayVersion: 'not_queried',
      returned: 1,
    });
    expect(body.releases[0]).not.toHaveProperty('secret');
    expect(body.releases[0].prs[0].url).toContain('/minion_hub/pull/1');
  });
  it('bounds result count and text with explicit coverage', async () => {
    fixture.releases = Array.from({ length: 30 }, (_, i) => ({
      version: 'hub-' + i,
      releasedAt: '2030-01-10',
      sections: { Fixed: { assistant: Array(25).fill('x'.repeat(2000)) } },
      prs: [],
    }));
    const body = await (await releases(event('limit=2'))).json();
    expect(body).toMatchObject({ total: 30, returned: 2, truncated: true, contentTruncated: true });
    expect(JSON.stringify(body).length).toBeLessThan(20_000);
    expect(body.releases[1].version).toBe('hub-1');
  });
  it('denies assignment before reading global notes', async () => {
    fixture.allowed = false;
    await expect(releases(event())).rejects.toMatchObject({ status: 403 });
    expect(fixture.notes).not.toHaveBeenCalled();
  });
  it('marks malformed dropped content and prevents oversized trusted-host PR URLs', async () => {
    fixture.releases = [
      {
        version: 'v'.repeat(101),
        releasedAt: '2030-01-10',
        sections: { bad: 42, Fixed: { assistant: [1, 'valid'] } },
        prs: [
          {
            number: 1,
            title: 'large',
            url: 'https://github.com/NikolasP98/minion_hub/pull/' + '1'.repeat(50_000),
          },
        ],
      },
    ];
    const body = await (await releases(event())).json();
    expect(body.contentTruncated).toBe(true);
    expect(body.releases[0].prs).toEqual([]);
    expect(body.releases[0].version).toHaveLength(100);
    expect(JSON.stringify(body).length).toBeLessThan(1000);
  });
  it('rejects an oversized request and preserves explicit empty success', async () => {
    await expect(releases(event('limit=100'))).rejects.toMatchObject({ status: 400 });
    fixture.releases = [];
    expect(await (await releases(event())).json()).toMatchObject({
      releases: [],
      returned: 0,
      total: 0,
      truncated: false,
    });
  });
});
