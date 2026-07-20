/**
 * WhatsApp history-sync setting — how much conversation history the gateway asks
 * the phone to hand over. The phone is what SENDS the history, so this is a real
 * cost knob, not a preference.
 *
 * Source of truth is the GATEWAY config (not the hub DB):
 *   - global   `gateway.messageLedger.historySync`         — unset means 'full'
 *   - override `channels.whatsapp.accounts.<id>.historySync` — unset inherits global
 *
 * Clearing an override uses RFC 7386 merge-patch `null` (same convention as
 * `replaceNestedScalar` in org-config-sync.service.ts and the account-removal
 * patch in ChannelCard).
 */

export type HistorySyncMode = 'full' | 'recent' | 'off';

/** Unset === 'full'. The gateway defaults to handing over everything. */
export const HISTORY_SYNC_DEFAULT: HistorySyncMode = 'full';

/** The sentinel the per-account control uses for "no override — inherit". */
export const INHERIT = 'default';

export type HistorySyncChoice = HistorySyncMode | typeof INHERIT;

function isMode(v: unknown): v is HistorySyncMode {
  return v === 'full' || v === 'recent' || v === 'off';
}

/** Read the global default out of a gateway config snapshot. */
export function readGlobalHistorySync(config: Record<string, unknown> | undefined): HistorySyncMode {
  const v = (
    config?.gateway as { messageLedger?: { historySync?: unknown } } | undefined
  )?.messageLedger?.historySync;
  return isMode(v) ? v : HISTORY_SYNC_DEFAULT;
}

/** Read one WhatsApp account's override, or null when it inherits. */
export function readAccountHistorySync(
  config: Record<string, unknown> | undefined,
  accountId: string | null | undefined,
): HistorySyncMode | null {
  if (!accountId) return null;
  const v = (
    config?.channels as
      | { whatsapp?: { accounts?: Record<string, { historySync?: unknown }> } }
      | undefined
  )?.whatsapp?.accounts?.[accountId]?.historySync;
  return isMode(v) ? v : null;
}

/** What the control shows as selected. */
export function selectedChoice(
  scope: 'global' | 'account',
  global: HistorySyncMode,
  override: HistorySyncMode | null,
): HistorySyncChoice {
  if (scope === 'global') return global;
  return override ?? INHERIT;
}

/** What actually happens on the wire for the given choice. */
export function effectiveMode(
  choice: HistorySyncChoice,
  global: HistorySyncMode,
): HistorySyncMode {
  return choice === INHERIT ? global : choice;
}

/**
 * Merge-patch body for a choice. `INHERIT` clears the account override with an
 * explicit `null` — the global key is never nulled (there is nothing above it).
 */
export function historySyncPatch(
  accountId: string | null,
  choice: HistorySyncChoice,
): Record<string, unknown> {
  if (!accountId) {
    return {
      gateway: { messageLedger: { historySync: effectiveMode(choice, HISTORY_SYNC_DEFAULT) } },
    };
  }
  return {
    channels: {
      whatsapp: {
        accounts: { [accountId]: { historySync: choice === INHERIT ? null : choice } },
      },
    },
  };
}
