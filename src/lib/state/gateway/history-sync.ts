import type { ChannelHistorySync } from '$lib/types/channels';

/** Phone-ish account ids arrive in several shapes (+51…, 51…@s.whatsapp.net). */
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * History-sync snapshot for one account out of a `channels.status` account list.
 * Surfaces holding a `Channel` should read `channel.historySync`; this is for the
 * ones that only know an account id (the wizard mid-pair, /account/connections).
 *
 * Matching is digits-based because the wizard knows the phone WhatsApp reported
 * while the snapshot may key the same account with or without a `+` or a jid
 * suffix. Kept gw-free so it stays unit-testable — `findHistorySync` in
 * gateway-data.svelte.ts is the live-state wrapper.
 */
export function pickHistorySync(
  accounts: { accountId: string; historySync?: ChannelHistorySync }[] | undefined,
  accountId: string | null | undefined,
): ChannelHistorySync | undefined {
  if (!accountId || !Array.isArray(accounts)) return undefined;
  const want = digits(accountId);
  // Too short to be a phone → refuse rather than fuzzy-match something else.
  if (want.length < 6) return undefined;
  const hit = accounts.find((a) => {
    const have = digits(a.accountId ?? '');
    // Without this floor, a non-phone id like 'default' (digits '') would
    // suffix-match every lookup.
    if (have.length < 6) return false;
    return have === want || have.endsWith(want) || want.endsWith(have);
  });
  return hit?.historySync;
}

/** True while the account is doing work the user should be able to see. */
export function isSyncActive(sync: ChannelHistorySync | undefined): boolean {
  return !!sync && sync.phase !== 'idle' && sync.phase !== 'complete';
}
