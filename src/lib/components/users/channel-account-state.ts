import type { ChannelHistorySync, ChannelHubSync } from '$lib/types/channels';

export type ChannelAccountUiState =
  | 'unlinked'
  | 'claimed'
  | 'sync-active'
  | 'syncing'
  | 'sync-paused'
  | 'reconnecting'
  | 'sync-offline'
  | 'connection-issue';

export interface LiveChannelAccount {
  accountId: string;
  enabled?: boolean | null;
  configured?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  reconnectAttempts?: number | null;
  lastError?: string | null;
  historySync?: ChannelHistorySync;
  hubSync?: ChannelHubSync;
}

const digits = (value: string) => value.replace(/\D/g, '');

/** Match the claimed phone to its live gateway account without fuzzy short-id matches. */
export function matchClaimedAccount<T extends LiveChannelAccount>(
  accounts: T[] | undefined,
  externalId: string | null | undefined,
): T | undefined {
  if (!externalId || !Array.isArray(accounts)) return undefined;
  const claimed = digits(externalId);
  if (claimed.length < 6) return undefined;

  return accounts.find((account) => {
    const accountId = digits(account.accountId);
    return (
      accountId.length >= 6 &&
      (accountId === claimed || accountId.endsWith(claimed) || claimed.endsWith(accountId))
    );
  });
}

/**
 * Account-level state for /account/connections.
 *
 * An identity claim is attribution only. It becomes an active integration only
 * when the gateway reports a matching WhatsApp account; health then overrides
 * the healthy state so the badge never celebrates a broken connection.
 */
export function deriveWhatsAppAccountState(
  hasIdentity: boolean,
  account: LiveChannelAccount | undefined,
): ChannelAccountUiState {
  if (!hasIdentity) return 'unlinked';
  if (!account) return 'claimed';
  if (account.lastError) return 'connection-issue';
  if (account.enabled === false || account.configured === false) return 'sync-offline';
  if (account.connected !== true) {
    return account.running === true || (account.reconnectAttempts ?? 0) > 0
      ? 'reconnecting'
      : 'sync-offline';
  }

  // A draining outbox is active work even if WhatsApp itself has stopped
  // sending history chunks. Do not regress to the old misleading "paused" UI.
  if ((account.hubSync?.pending ?? 0) > 0) return 'syncing';
  const phase = account.historySync?.phase;
  if (phase === 'bootstrap' || phase === 'recent' || phase === 'full' || phase === 'on-demand')
    return 'syncing';
  if (phase === 'stalled') return 'sync-paused';
  return 'sync-active';
}
