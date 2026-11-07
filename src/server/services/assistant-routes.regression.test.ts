import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/permissions', () => ({ SENSITIVE_FIELD_LEVEL: 1 }));
const fixture = vi.hoisted(() => ({
  allowed: true,
  fieldLevel: 0,
  preview: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  summary: vi.fn(),
  series: vi.fn(),
  products: vi.fn(),
  clients: vi.fn(),
}));
vi.mock('../../routes/api/gateway/_shared/action-auth', () => ({
  requireAssistantCapability: async () => {
    if (!fixture.allowed) throw Object.assign(new Error('denied'), { status: 403 });
    return {
      ctx: { tenantId: 'synthetic-org', profileId: 'synthetic-profile' },
      capabilities: { fieldLevel: () => fixture.fieldLevel },
    };
  },
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  previewAssistantBooking: fixture.preview,
  createBooking: fixture.create,
  queryAssistantBookings: fixture.list,
  listBookings: async (...args: unknown[]) => (await fixture.list(...args)).bookings,
  SlotUnavailableError: class extends Error {},
}));
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
  financeSummary: fixture.summary,
  revenueSeries: fixture.series,
  topProducts: fixture.products,
  topClients: fixture.clients,
  maskFinanceSummary: () => ({ masked: true }),
}));
import { POST } from '../../routes/api/gateway/actions/booking-create/+server';
import { GET as bookings } from '../../routes/api/gateway/query/bookings/+server';
import { GET as finance } from '../../routes/api/gateway/query/finance/+server';
import { parseAssistantPeriod } from './assistant-period';
import { parsePeriod } from '../../lib/finance/period';
const url = (params = '') => new URL('https://fixture.invalid/?' + params);
const event = (params = '') => ({ locals: {}, url: url(params) }) as never;
const body = {
  confirm: false,
  eventTypeId: 'synthetic-service',
  start: '2030-01-07T14:00:00Z',
  crmContactId: 'synthetic-contact',
  resourceId: 'synthetic-staff',
  attendeeEmail: 'fixture@example.invalid',
  attendeePhone: '+15550000000',
};
const post = (patch = {}) =>
  POST({
    locals: {},
    url: url(),
    request: new Request('https://fixture.invalid/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ...patch }),
    }),
  } as never);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.allowed = true;
  fixture.fieldLevel = 0;
  fixture.preview.mockResolvedValue({
    ...body,
    resourceId: body.resourceId,
    resourceName: 'Staff',
    crmContactId: body.crmContactId,
    contactName: 'Customer',
    serviceTitle: 'Service',
    availability: 'available-at-preview',
    reservesSlot: false,
  });
  fixture.create.mockResolvedValue({ id: 'booking' });
  fixture.list.mockResolvedValue({
    bookings: [],
    total: 0,
    returned: 0,
    limit: 500,
    truncated: false,
    mode: 'list',
  });
  fixture.summary.mockResolvedValue({ cost: 999 });
  fixture.series.mockResolvedValue([]);
  fixture.products.mockResolvedValue([]);
  fixture.clients.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('C03 real POST authority/preflight adapter', () => {
  it('routes preview through native preflight interface with strict identity and masks returned PII', async () => {
    const response = await (await post()).json();
    expect(fixture.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'synthetic-org',
        profileId: 'synthetic-profile',
      }),
      expect.objectContaining({
        strictContactReference: true,
        crmContactId: body.crmContactId,
        preferredResourceId: body.resourceId,
        bypassRules: true,
      }),
    );
    expect(response.preview).toMatchObject({
      resourceId: body.resourceId,
      crmContactId: body.crmContactId,
    });
    expect(response.preview.attendeeEmail).not.toBe(body.attendeeEmail);
    expect(response.preview.attendeePhone).not.toBe(body.attendeePhone);
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it('passes the strict identity contract on actual commit', async () => {
    await post({ confirm: true });
    expect(fixture.preview).not.toHaveBeenCalled();
    expect(fixture.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        strictContactReference: true,
        crmContactId: body.crmContactId,
      }),
    );
  });
  it('stops all preflight and create calls on denied authority', async () => {
    fixture.allowed = false;
    await expect(post()).rejects.toMatchObject({ status: 403 });
    expect(fixture.preview).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });
});

describe('C04 real list route', () => {
  it('preserves completeness metadata and trusted masking context', async () => {
    fixture.list.mockResolvedValue({
      bookings: Array(500).fill({ id: 'synthetic' }),
      total: 501,
      returned: 500,
      truncated: true,
      limit: 500,
      mode: 'list',
    });
    const response = await (
      await bookings(event('from=2030-01-07T14:00:00Z&to=2030-01-07T14:00:00Z'))
    ).json();
    expect(response).toMatchObject({
      total: 501,
      returned: 500,
      truncated: true,
    });
    expect(fixture.list).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'synthetic-profile' }),
      expect.objectContaining({
        maskAttendeePii: true,
        limit: 500,
        countOnly: false,
      }),
    );
  });
  it('exposes exact count and bounded user limit', async () => {
    await bookings(event('mode=count&limit=20'));
    expect(fixture.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ countOnly: true, limit: 20 }),
    );
  });
  it.each([
    'limit=501',
    'limit=0',
    'limit=x',
    'mode=whatever',
    'from=invalid',
    'from=2030-01-08&to=2030-01-07',
  ])('rejects explicit invalid filter %s', async (params) => {
    await expect(bookings(event(params))).rejects.toMatchObject({
      status: 400,
    });
    expect(fixture.list).not.toHaveBeenCalled();
  });
  it('stops denied lists before service entry', async () => {
    fixture.allowed = false;
    await expect(bookings(event())).rejects.toMatchObject({ status: 403 });
    expect(fixture.list).not.toHaveBeenCalled();
  });
});

describe('C05 actual agent parser and finance route', () => {
  it.each([
    'from=not-a-date',
    'to=2030-02-30',
    'from=',
    'from=2030-01-08&to=2030-01-07',
    'range=all&from=2030-01-07',
    'bucket=invalid',
    'from=2030-01-07T00:00:00Z',
  ])('strictly rejects explicit invalid or contradictory input %s', async (params) => {
    await expect(finance(event(params))).rejects.toMatchObject({
      status: 400,
    });
    expect(fixture.summary).not.toHaveBeenCalled();
  });
  it('uses inclusive local calendar days with exclusive next midnight in Lima, and discloses it', async () => {
    const result = await (await finance(event('from=2030-01-07&to=2030-01-07'))).json();
    expect(result.period).toEqual({
      from: '2030-01-07T05:00:00.000Z',
      to: '2030-01-08T05:00:00.000Z',
      bucket: 'month',
    });
    expect(result.periodSemantics).toMatchObject({
      timezone: 'America/Lima',
      mode: 'explicit-days',
      upper: 'exclusive',
      dateTo: 'inclusive-local-day',
    });
    expect(fixture.summary.mock.calls[0][1]).toEqual(result.period);
    expect(fixture.series).toHaveBeenCalledWith(
      expect.anything(),
      result.period,
      undefined,
      undefined,
      { timezone: 'America/Lima' },
    );
    expect(result.summary).toEqual({ masked: true });
  });
  it('handles DST day boundaries using the native timezone helper', () => {
    expect(
      parseAssistantPeriod(url('from=2030-03-10&to=2030-03-10'), 'America/New_York').period,
    ).toEqual({
      from: '2030-03-10T05:00:00.000Z',
      to: '2030-03-11T04:00:00.000Z',
      bucket: 'month',
    });
  });
  it('exposes explicit all time with open bounds', async () => {
    const result = await (await finance(event('range=all'))).json();
    expect(result.period).toEqual({ from: null, to: null, bucket: 'month' });
    expect(result.periodSemantics.mode).toBe('all');
  });
  it('retains dashboard absent/default parser and discloses the agent default in the business day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-07T02:00:00Z'));
    expect(parsePeriod(url())).toEqual({
      from: '2029-01-07T02:00:00.000Z',
      to: '2030-01-07T02:00:00.000Z',
      bucket: 'month',
    });
    const agent = parseAssistantPeriod(url(), 'America/Lima');
    expect(agent.periodSemantics).toMatchObject({
      mode: 'rolling-12-months',
      calendarTo: '2030-01-06',
    });
  });
  it('denies finance before data queries', async () => {
    fixture.allowed = false;
    await expect(finance(event('range=all'))).rejects.toMatchObject({
      status: 403,
    });
    expect(fixture.summary).not.toHaveBeenCalled();
  });
});
