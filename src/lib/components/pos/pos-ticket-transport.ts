export interface PosTicketRequest {
  lines: Array<{
    kind: 'service' | 'product';
    finProductId: string | null;
    bookingId: string | null;
    description: string;
    qty: number;
    unitPrice: number;
    discount: number;
    planId: string | null;
    redemptionId: string | null;
  }>;
  payments: Array<{ method: string; amount: number; tendered: number | null }>;
  partyId: string | null;
  customerName: string | null;
  allowNegativeStock: boolean;
}

export interface PosTicketResult {
  ok: true;
  ticket: { id: string; humanId: string | null };
  stockWarning: { message: string } | null;
}

export class PosTicketRejected extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly items: Array<{ itemName: string; requested: number; available: number }>;

  constructor(
    status: number,
    detail: string,
    code: string | null,
    items: Array<{ itemName: string; requested: number; available: number }>,
  ) {
    super(detail);
    this.name = 'PosTicketRejected';
    this.status = status;
    this.code = code;
    this.items = items;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejection(body: unknown, status: number): PosTicketRejected {
  const value = object(body);
  const items = Array.isArray(value?.items)
    ? value.items.flatMap((candidate) => {
        const item = object(candidate);
        return item &&
          typeof item.itemName === 'string' &&
          typeof item.requested === 'number' &&
          typeof item.available === 'number'
          ? [
              {
                itemName: item.itemName,
                requested: item.requested,
                available: item.available,
              },
            ]
          : [];
      })
    : [];
  return new PosTicketRejected(
    status,
    typeof value?.error === 'string' ? value.error : `Failed (${status})`,
    typeof value?.code === 'string' ? value.code : null,
    items,
  );
}

export async function submitPosTicket(options: {
  request: PosTicketRequest;
  paymentPolicyRevision: string;
  fetcher?: typeof fetch;
}): Promise<PosTicketResult> {
  if (!/^[0-9a-f]{64}$/.test(options.paymentPolicyRevision)) {
    throw new TypeError('payment policy revision is unavailable');
  }
  const response = await (options.fetcher ?? fetch)('/api/pos/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...options.request,
      paymentPolicyRevision: options.paymentPolicyRevision,
    }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw rejection(null, response.status);
    throw new Error('Ticket response is invalid.');
  }
  if (!response.ok) throw rejection(body, response.status);
  const value = object(body);
  const ticket = object(value?.ticket);
  const warning = value?.stockWarning === null ? null : object(value?.stockWarning);
  if (
    value?.ok !== true ||
    !ticket ||
    typeof ticket.id !== 'string' ||
    !(ticket.humanId === null || typeof ticket.humanId === 'string') ||
    !(warning === null || typeof warning?.message === 'string')
  ) {
    throw new Error('Ticket response is invalid.');
  }
  return {
    ok: true,
    ticket: { id: ticket.id, humanId: ticket.humanId },
    stockWarning: warning === null ? null : { message: warning.message as string },
  };
}
