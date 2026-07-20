import { describe, it, expect } from 'vitest';
import { pickHistorySync, isSyncActive } from './history-sync';
import type { ChannelHistorySync } from '$lib/types/channels';

const sync = (over: Partial<ChannelHistorySync> = {}): ChannelHistorySync => ({
  phase: 'recent',
  progress: 40,
  explicit: true,
  messages: 10,
  chats: 2,
  startedAt: 1,
  updatedAt: 2,
  ...over,
});

const accounts = [
  { accountId: 'default' },
  { accountId: '+51922286663', historySync: sync() },
];

describe('pickHistorySync', () => {
  it('matches a phone regardless of + / spacing / jid suffix', () => {
    expect(pickHistorySync(accounts, '51922286663')?.messages).toBe(10);
    expect(pickHistorySync(accounts, '+51 922 286 663')?.messages).toBe(10);
    expect(pickHistorySync(accounts, '51922286663@s.whatsapp.net')?.messages).toBe(10);
  });

  it('never falls back to a non-phone account like "default"', () => {
    expect(pickHistorySync(accounts, '51999999999')).toBeUndefined();
    expect(pickHistorySync(accounts, 'default')).toBeUndefined();
  });

  it('returns undefined without accounts or an id', () => {
    expect(pickHistorySync(undefined, '51922286663')).toBeUndefined();
    expect(pickHistorySync(accounts, null)).toBeUndefined();
  });
});

describe('isSyncActive', () => {
  it('is true only while there is work in flight', () => {
    expect(isSyncActive(undefined)).toBe(false);
    expect(isSyncActive(sync({ phase: 'idle' }))).toBe(false);
    expect(isSyncActive(sync({ phase: 'complete' }))).toBe(false);
    expect(isSyncActive(sync({ phase: 'recent' }))).toBe(true);
    expect(isSyncActive(sync({ phase: 'stalled' }))).toBe(true);
  });
});
