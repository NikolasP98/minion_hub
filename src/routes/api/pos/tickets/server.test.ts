import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/pos/tickets: a repeated client ticket id answers 200 with the first ticket. */
const mocks = vi.hoisted(() => ({
  submitTicket: vi.fn(),
  ctx: { db: {}, tenantId: 'org-1', profileId: 'me' } as Record<string, unknown>,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => Promise.resolve(mocks.ctx) }));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: () => Promise.resolve(),
}));
vi.mock('$server/services/pos.service', async () => ({
  PosError: (await import('$server/services/pos/errors')).PosError,
  listTickets: vi.fn(),
  submitTicket: (...args: unknown[]) => mocks.submitTicket(...args),
}));
import { PosError } from '$server/services/pos/errors';
import { POST } from './+server';

const TICKET_ID = '7c1f1a52-2d4e-4f3a-9b6e-0d3c5e8f9a10';
const ticket = { id: TICKET_ID, humanId: 'POS-1' };

function post(body: Record<string, unknown>) {
  return {
    locals: {},
    request: new Request('http://localhost/api/pos/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
        payments: [{ method: 'cash', amount: 10, tendered: 10 }],
        paymentPolicyRevision: 'a'.repeat(64),
        ...body,
      }),
    }),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx = { db: {}, tenantId: 'org-1', profileId: 'me' };
});

describe('POST /api/pos/tickets', () => {
  it('answers 201 for a fresh sale and passes the client id through', async () => {
    mocks.submitTicket.mockResolvedValue({ ticket, stockWarning: null });
    const res = await POST(post({ ticketId: TICKET_ID }));
    expect(res.status).toBe(201);
    expect(mocks.submitTicket.mock.calls[0][1]).toMatchObject({ ticketId: TICKET_ID });
  });

  it('answers 200 with the stored ticket for a replay', async () => {
    mocks.submitTicket.mockResolvedValue({ ticket, stockWarning: null, replayed: true });
    const res = await POST(post({ ticketId: TICKET_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ticket, stockWarning: null });
  });

  it('answers 409 when the id belongs to another sale', async () => {
    mocks.submitTicket.mockRejectedValue(new PosError('taken', 'operation_conflict'));
    const res = await POST(post({ ticketId: TICKET_ID }));
    expect(res.status).toBe(409);
  });

  it('answers 403 when an id arrives without a signed-in profile', async () => {
    mocks.ctx = { db: {}, tenantId: 'org-1', profileId: null };
    mocks.submitTicket.mockRejectedValue(new PosError('who', 'operation_actor_required'));
    const res = await POST(post({ ticketId: TICKET_ID }));
    expect(res.status).toBe(403);
  });

  it('refuses an id that is not a UUID before the service runs', async () => {
    await expect(POST(post({ ticketId: 'not-a-uuid' }))).rejects.toMatchObject({ status: 400 });
    expect(mocks.submitTicket).not.toHaveBeenCalled();
  });
});
