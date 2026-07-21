import { describe, it, expect } from 'vitest';
import {
  MESSAGE_CONFLICT_TARGET,
  toInsertValues,
  toTimestampMs,
  type IngestRow,
} from './messages.service';

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

describe('message ingest idempotency', () => {
  it('scopes client IDs to the organization', () => {
    expect(MESSAGE_CONFLICT_TARGET.map((column) => column.name)).toEqual(['org_id', 'client_id']);
  });
});

describe('toTimestampMs', () => {
  it('normalizes Date, ISO text, and numeric driver values', () => {
    const timestamp = 1_784_611_440_671;
    expect(toTimestampMs(new Date(timestamp))).toBe(timestamp);
    expect(toTimestampMs(new Date(timestamp).toISOString())).toBe(timestamp);
    expect(toTimestampMs(timestamp)).toBe(timestamp);
    expect(toTimestampMs(String(timestamp))).toBe(timestamp);
  });

  it('returns null for nullish and invalid values', () => {
    expect(toTimestampMs(null)).toBeNull();
    expect(toTimestampMs('not-a-date')).toBeNull();
    expect(toTimestampMs(new Date('invalid'))).toBeNull();
  });
});
