import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ gateway: vi.fn(), insert: vi.fn(), thread: [] as unknown[] }));
vi.mock('$server/db/with-org-core', () => ({ withOrgCore: async () => h.thread }));
vi.mock('$lib/server/gateway-rpc', () => ({
  gatewayCall: (...a: unknown[]) => h.gateway(...a),
}));
vi.mock('./messages.service', () => ({ insertMessages: (...a: unknown[]) => h.insert(...a) }));

import { buildOutboundRow, sendContactMessage } from './crm-send.service';

const ctx = { db: null as never, tenantId: 'org-1' };

describe('sendContactMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.thread = [{ to: '+51900000041', account_id: 'acct-thread', gateway_id: 'gw-1' }];
  });

  it('infers the account from the latest thread by default', async () => {
    await sendContactMessage(ctx, 'c1', 'whatsapp', ' hola ', 'k1');
    expect(h.gateway).toHaveBeenCalledWith('channels.send', {
      channel: 'whatsapp',
      to: '+51900000041',
      text: 'hola',
      accountId: 'acct-thread',
      idempotencyKey: 'k1',
    });
  });

  it('opts.accountId overrides the inferred account, also on the ledger row', async () => {
    h.thread = [{ to: '+51900000041', account_id: null, gateway_id: null }];
    await sendContactMessage(ctx, 'c1', 'whatsapp', 'hola', 'door-fu-d-c1', {
      accountId: 'acct-door',
    });
    expect(h.gateway.mock.calls[0][1]).toMatchObject({
      accountId: 'acct-door',
      idempotencyKey: 'door-fu-d-c1',
    });
    expect(h.insert.mock.calls[0][2][0]).toMatchObject({
      accountId: 'acct-door',
      clientId: 'door-fu-d-c1',
    });
  });
});

describe('buildOutboundRow', () => {
  it('produces a deterministic outbound ledger row for a CRM send', () => {
    const row = buildOutboundRow({
      contactId: 'c1',
      channel: 'whatsapp',
      to: '+51922286663',
      accountId: '+51906090526',
      text: '  hola  ',
      occurredAt: 1718900000000,
    });
    expect(row.clientId).toBe('crm-send:c1:1718900000000');
    expect(row.direction).toBe('outbound');
    expect(row.chatId).toBe('+51922286663');
    expect(row.accountId).toBe('+51906090526');
    expect(row.content).toBe('  hola  '); // caller trims before passing
    expect(row.isBot).toBe(false);
    expect(row.metadata).toEqual({ source: 'crm-compose' });
  });
});
