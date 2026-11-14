import { describe, expect, it, vi } from 'vitest';
import {
  PosTicketRejected,
  submitPosTicket,
  ticketAttemptFor,
  type PosTicketRequest,
} from './pos-ticket-transport';

const REVISION = 'a'.repeat(64);
const request: PosTicketRequest = {
  lines: [],
  payments: [],
  partyId: null,
  customerName: null,
  allowNegativeStock: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POS ticket transport', () => {
  it('echoes the frozen payment policy revision in exactly one POST', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, ticket: { id: 't-1', humanId: null }, stockWarning: null }),
      );

    await expect(
      submitPosTicket({ request, paymentPolicyRevision: REVISION, fetcher }),
    ).resolves.toEqual({
      ok: true,
      ticket: { id: 't-1', humanId: null },
      stockWarning: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ ...request, paymentPolicyRevision: REVISION });
  });

  it('rejects an unavailable revision before dispatch', async () => {
    const fetcher = vi.fn();
    await expect(
      submitPosTicket({ request, paymentPolicyRevision: 'missing', fetcher }),
    ).rejects.toThrow('payment policy revision is unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns the typed settings-change rejection without replaying', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'Payment settings changed.', code: 'pos_settings_changed' }, 409),
      );

    await expect(
      submitPosTicket({ request, paymentPolicyRevision: REVISION, fetcher }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PosTicketRejected &&
        error.status === 409 &&
        error.code === 'pos_settings_changed',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats malformed 2xx as an unknown result and never dispatches again', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      submitPosTicket({ request, paymentPolicyRevision: REVISION, fetcher }),
    ).rejects.toThrow('Ticket response is invalid.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('POS ticket id per charge attempt', () => {
  const cart: PosTicketRequest = {
    lines: [
      {
        kind: 'product',
        finProductId: 'fp-1',
        bookingId: null,
        description: 'Retail',
        qty: 2,
        unitPrice: 10,
        discount: 0,
        planId: null,
        redemptionId: null,
      },
    ],
    payments: [{ method: 'cash', amount: 20, tendered: 20 }],
    partyId: 'party-1',
    customerName: null,
    allowNegativeStock: false,
  };
  let n = 0;
  const mint = () => `id-${++n}`;

  it('keeps the id for the same request, including a charge-anyway retry', () => {
    const first = ticketAttemptFor(null, cart, mint);
    expect(ticketAttemptFor(first, structuredClone(cart), mint).id).toBe(first.id);
    expect(ticketAttemptFor(first, { ...cart, allowNegativeStock: true }, mint).id).toBe(first.id);
  });

  it('mints a new id when the lines, payments or customer change', () => {
    const first = ticketAttemptFor(null, cart, mint);
    const edits: PosTicketRequest[] = [
      { ...cart, lines: [{ ...cart.lines[0], qty: 3 }] },
      { ...cart, payments: [{ method: 'card', amount: 20, tendered: null }] },
      { ...cart, partyId: 'party-2' },
    ];
    for (const edit of edits) expect(ticketAttemptFor(first, edit, mint).id).not.toBe(first.id);
  });

  it('sends the id with the request', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, ticket: { id: 'id-9', humanId: null }, stockWarning: null }),
      );
    await submitPosTicket({
      request: { ...request, ticketId: 'id-9' },
      paymentPolicyRevision: REVISION,
      fetcher,
    });
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.ticketId).toBe('id-9');
  });
});
