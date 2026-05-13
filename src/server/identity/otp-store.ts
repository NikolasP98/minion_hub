import { randomUUID, randomInt } from 'node:crypto';

type Entry = {
  userId: string;
  channel: string;
  channelUserId: string;
  code: string;
  expiresAt: number;
};

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000;

export function createOtp(input: {
  userId: string;
  channel: string;
  channelUserId: string;
}): { requestId: string; code: string } {
  const requestId = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  store.set(requestId, { ...input, code, expiresAt: Date.now() + TTL_MS });
  return { requestId, code };
}

export type ConsumeResult =
  | { ok: true; userId: string; channel: string; channelUserId: string }
  | { ok: false; reason: 'unknown' | 'mismatch' | 'expired' };

export function consumeOtp(requestId: string, code: string): ConsumeResult {
  const entry = store.get(requestId);
  if (!entry) return { ok: false, reason: 'unknown' };
  if (entry.expiresAt < Date.now()) {
    store.delete(requestId);
    return { ok: false, reason: 'expired' };
  }
  if (entry.code !== code) return { ok: false, reason: 'mismatch' };
  store.delete(requestId);
  return {
    ok: true,
    userId: entry.userId,
    channel: entry.channel,
    channelUserId: entry.channelUserId,
  };
}
