import { describe, it, expect } from 'vitest';
import { buildOutboundRow } from './crm-send.service';

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
