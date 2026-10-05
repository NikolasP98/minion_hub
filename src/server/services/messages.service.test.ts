import { describe, it, expect, vi } from 'vitest';
import {
  MESSAGE_CONFLICT_TARGET,
  acceptedIngestRows,
  insertMessagesInOwnedTransaction,
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

function sqlError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

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

  it('queues brain work only for rows that survived poison-row fallback', () => {
    const rejected = { ...base, clientId: 'bad', chatId: 'bad-chat' };
    expect(acceptedIngestRows([base, rejected], ['c1'])).toEqual([base]);
  });

  it('uses nested savepoints so one poison row does not abort the owned outer transaction', async () => {
    const rejected = { ...base, clientId: 'bad', chatId: 'bad-chat' };
    let transactionCall = 0;
    const transaction = vi.fn(async (operation: (savepoint: unknown) => Promise<unknown>) => {
      transactionCall++;
      if (transactionCall === 1) throw sqlError('23514', 'sensitive bulk constraint detail');
      const savepoint = {
        insert: () => ({
          values: (value: { clientId: string }) => ({
            onConflictDoUpdate: async () => {
              if (value.clientId === 'bad') throw sqlError('22001', 'sensitive poison row detail');
            },
          }),
        }),
      };
      return operation(savepoint);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        insertMessagesInOwnedTransaction({ transaction } as never, 'orgA', 'srv-1', [
          base,
          rejected,
        ]),
      ).resolves.toEqual({ accepted: 1, acceptedClientIds: ['c1'] });
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(warning.mock.calls)).not.toContain('sensitive');
    } finally {
      warning.mockRestore();
    }
  });

  it('rethrows a transient bulk failure without attempting row fallback', async () => {
    const transient = sqlError('40001', 'serialization failure');
    const transaction = vi.fn(async () => {
      throw transient;
    });

    await expect(
      insertMessagesInOwnedTransaction({ transaction } as never, 'orgA', 'srv-1', [base]),
    ).rejects.toBe(transient);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rethrows a transient row failure so the owned outer transaction cannot commit siblings', async () => {
    const second = { ...base, clientId: 'c2', chatId: 'chat2' };
    const transient = sqlError('57014', 'statement timeout');
    let transactionCall = 0;
    const transaction = vi.fn(async (operation: (savepoint: unknown) => Promise<unknown>) => {
      transactionCall++;
      if (transactionCall === 1) throw sqlError('23514', 'bulk constraint');
      if (transactionCall === 3) throw transient;
      return operation({
        insert: () => ({
          values: () => ({ onConflictDoUpdate: async () => undefined }),
        }),
      });
    });

    await expect(
      insertMessagesInOwnedTransaction({ transaction } as never, 'orgA', 'srv-1', [base, second]),
    ).rejects.toBe(transient);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not open a savepoint for an empty owned message batch', async () => {
    const transaction = vi.fn();
    await expect(
      insertMessagesInOwnedTransaction({ transaction } as never, 'orgA', null, []),
    ).resolves.toEqual({ accepted: 0, acceptedClientIds: [] });
    expect(transaction).not.toHaveBeenCalled();
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
