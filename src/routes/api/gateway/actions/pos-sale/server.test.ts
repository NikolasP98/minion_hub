import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
const auth = vi.hoisted(() => ({ authorize: vi.fn(), actor: vi.fn() }));
vi.mock('../../_shared/action-auth', () => ({
  requireAssistantCapability: auth.authorize,
  agentActor: auth.actor,
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));
import { POST } from './+server';

beforeEach(() => {
  vi.clearAllMocks();
});
const sale = (extra = {}) => ({
  lines: [{ kind: 'service', description: 'Synthetic preview', qty: 1, unitPrice: 1.005 }],
  payments: [{ method: 'cash', amount: 1.01, tendered: 2 }],
  ...extra,
});
function request(body: unknown) {
  const url = new URL('http://localhost/api/gateway/actions/pos-sale');
  return {
    locals: {},
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0];
}

describe('assistant POS money preview', () => {
  it('runs actual shared sale math and reads only settings and open-shift identity without a write', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], [{ id: 'open-shift' }]]);
    auth.authorize.mockResolvedValue({
      ctx: { db, tenantId: 'org-fixture' },
      principalId: 'fixture',
    });
    const response = await POST(request(sale()));
    expect(await response.json()).toMatchObject({
      preview: { subtotal: 1.01, total: 1.01, openShift: true, lines: [{ total: 1.01 }] },
    });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(auth.actor).not.toHaveBeenCalled();
  });
  it.each([
    [
      sale({
        lines: [
          { kind: 'service', description: 'Synthetic', qty: 1, unitPrice: 1.005, discount: 1.02 },
        ],
      }),
      'invalid_discount',
    ],
    [sale({ payments: [{ method: 'cash', amount: 1 }] }), 'payment_mismatch'],
    [sale({ payments: [{ method: 'cash', amount: 1.01, tendered: 1 }] }), 'invalid_tender'],
  ])('returns a mapped domain failure instead of an uncaught preview error', async (body, code) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    auth.authorize.mockResolvedValue({
      ctx: { db, tenantId: 'org-fixture' },
      principalId: 'fixture',
    });
    const response = await POST(request(body));
    expect(await response.json()).toMatchObject({ ok: false, code });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
  it('rejects an unsupported configured currency before opening or submitting a sale', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ currency: 'JPY', methods: [] }]]);
    auth.authorize.mockResolvedValue({
      ctx: { db, tenantId: 'org-fixture' },
      principalId: 'fixture',
    });
    expect(await (await POST(request(sale()))).json()).toMatchObject({
      ok: false,
      code: 'unsupported_pos_currency',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
