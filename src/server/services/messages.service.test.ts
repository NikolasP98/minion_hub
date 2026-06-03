import { describe, it, expect } from 'vitest';
import { toInsertValues, type IngestRow } from './messages.service';

const base: IngestRow = {
  clientId: 'c1',
  direction: 'inbound',
  channel: 'telegram',
  accountId: 'a1',
  chatId: 'chat1',
  isGroup: true,
  senderId: 's1',
  senderName: 'Alice',
  senderHandle: 'alice',
  isBot: false,
  content: 'hi',
  messageId: 'm1',
  agentId: null,
  sessionKey: null,
  success: null,
  error: null,
  occurredAt: 1700000000000,
  metadata: { x: 1 },
};

describe('toInsertValues', () => {
  it('stamps org_id + gateway_id and converts occurredAt to Date', () => {
    const v = toInsertValues(base, 'orgA', 'srv-1');
    expect(v.orgId).toBe('orgA');
    expect(v.gatewayId).toBe('srv-1');
    expect(v.occurredAt).toBeInstanceOf(Date);
    expect(v.occurredAt?.getTime()).toBe(1700000000000);
    expect(v.metadata).toEqual({ x: 1 });
    expect(v.clientId).toBe('c1');
  });

  it('handles null occurredAt', () => {
    const v = toInsertValues({ ...base, occurredAt: null as unknown as number }, 'orgA', null);
    expect(v.occurredAt).toBeNull();
    expect(v.gatewayId).toBeNull();
  });
});
