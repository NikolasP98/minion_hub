import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  allowed: true,
  settings: vi.fn(),
  actor: vi.fn(),
  create: vi.fn(),
}));
vi.mock('../../routes/api/gateway/_shared/action-auth', () => ({
  requireAssistantCapability: async () => {
    if (!fixture.allowed) throw Object.assign(new Error('denied'), { status: 403 });
    return { ctx: { tenantId: 'fixture-org' }, principalId: 'fixture-principal' };
  },
  agentActor: fixture.actor,
}));
vi.mock('$server/services/stock.service', () => ({ createEntry: fixture.create }));
vi.mock('$server/services/finance.service', () => ({ getFinSettings: fixture.settings }));
import { POST } from '../../routes/api/gateway/actions/stock-entry-create/+server';

const fin = {
  currency: 'PEN',
  fxBase: 'USD',
  fxQuote: 'PEN',
  fxRate: 3.75,
  fxUpdatedAt: '2030-01-01T00:00:00Z',
};
const request = (patch: Record<string, unknown> = {}) =>
  POST({
    locals: {},
    url: new URL('https://fixture.invalid/'),
    request: new Request('https://fixture.invalid/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: false,
        type: 'receipt',
        currency: 'USD',
        lines: [{ itemId: 'fixture-item', qty: 20, rate: 100, toWarehouseId: 'fixture-bin' }],
        ...patch,
      }),
    }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  fixture.allowed = true;
  fixture.settings.mockResolvedValue({ ...fin });
  fixture.actor.mockResolvedValue({ id: 'fixture-profile' });
  fixture.create.mockImplementation(async (_ctx, input) => ({
    id: 'fixture-draft',
    status: 'draft',
    ...input,
  }));
});

describe('assistant stock currency and rate-basis action', () => {
  it('previews USD unit rates in valuation currency without creating an entry', async () => {
    const body = await (await request()).json();
    expect(body.preview).toMatchObject({
      inputCurrency: 'USD',
      inputRateMode: 'unit',
      valuationCurrency: 'PEN',
      rateMode: 'unit',
      lines: [{ qty: 20, rate: 375 }],
      metadata: {
        inputCurrency: 'USD',
        inputRateMode: 'unit',
        currency: 'USD',
        fxRate: 3.75,
        fxUpdatedAt: fin.fxUpdatedAt,
      },
    });
    expect(fixture.actor).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('normalizes line totals before FX and commits the same rates and provenance as preview', async () => {
    const patch = {
      rateMode: 'total',
      lines: [{ itemId: 'fixture-item', qty: 20, rate: 2000, toWarehouseId: 'fixture-bin' }],
    };
    const preview = (await (await request(patch)).json()).preview;
    const response = await request({ ...patch, confirm: true });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(preview.lines[0].rate).toBe(375);
    expect(body.entry).toMatchObject({
      status: 'draft',
      lines: preview.lines,
      metadata: preview.metadata,
    });
    expect(preview.inputRateMode).toBe('total');
    expect(fixture.create).toHaveBeenCalledExactlyOnceWith(
      { tenantId: 'fixture-org' },
      expect.objectContaining({ lines: preview.lines, metadata: preview.metadata }),
      { id: 'fixture-profile' },
    );
  });

  it('keeps omitted currency and basis in the org valuation unit, including zero cost', async () => {
    fixture.settings.mockResolvedValue({ ...fin, currency: 'USD' });
    const body = await (
      await request({ currency: undefined, lines: [{ itemId: 'fixture-item', qty: 1, rate: 0 }] })
    ).json();
    expect(body.preview).toMatchObject({
      inputCurrency: 'USD',
      inputRateMode: 'unit',
      valuationCurrency: 'USD',
      lines: [{ rate: 0 }],
      metadata: { inputCurrency: 'USD', inputRateMode: 'unit' },
    });
  });

  it.each([
    { currency: 'EUR' },
    { rateMode: 'guess' },
    { lines: [{ itemId: 'a', qty: 0, rate: 10 }] },
  ])(
    'rejects unsupported or invalid input before reading settings or creating: %j',
    async (patch) => {
      await expect(request(patch)).rejects.toMatchObject({ status: 400 });
      expect(fixture.settings).not.toHaveBeenCalled();
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])('rejects missing FX for confirm=%s without effects', async (confirm) => {
    fixture.settings.mockResolvedValue({ ...fin, fxRate: null });
    await expect(request({ confirm })).rejects.toMatchObject({
      status: 422,
      body: { code: 'fx_rate_missing' },
    });
    expect(fixture.actor).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each([-1, Infinity])(
    'rejects invalid configured FX %s without forwarding rates',
    async (fxRate) => {
      fixture.settings.mockResolvedValue({ ...fin, fxRate });
      await expect(request({ confirm: true })).rejects.toMatchObject({
        status: 422,
        body: { code: 'fx_rate_missing' },
      });
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it('rejects nonfinite normalized totals instead of forwarding an overflow', async () => {
    await expect(
      request({
        rateMode: 'total',
        lines: [{ itemId: 'a', qty: Number.MIN_VALUE, rate: Number.MAX_VALUE }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('requires stock authority before reading finance settings', async () => {
    fixture.allowed = false;
    await expect(request({ confirm: true })).rejects.toMatchObject({ status: 403 });
    expect(fixture.settings).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
