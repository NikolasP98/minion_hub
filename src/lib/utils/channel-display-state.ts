import type { Channel } from '$lib/types/channels';

export type ChannelDisplayState =
  | 'disabled'
  | 'pending-config'
  | 'not-linked'
  | 'starting'
  | 'pairing'
  | 'identity-mismatch'
  | 'live'
  | 'degraded'
  | 'syncing'
  | 'sync-stalled'
  | 'error';

/**
 * SECURITY (cross-org isolation): is a gateway-sourced channel account visible
 * to the active org? Mirrors the gateway's orgScopeVisible but is STRICTER on
 * the no-tag case — an account with no `orgIds` is hidden while an org is
 * selected. The unscoped heartbeat snapshot carries no orgIds, so this is what
 * stops other orgs' accounts (and that snapshot) from bleeding into the list.
 * No active org (admin / single-tenant) sees everything.
 */
export function channelOrgVisible(
  orgIds: string[] | undefined,
  activeOrgId: string | null,
): boolean {
  return !activeOrgId || (orgIds?.includes(activeOrgId) ?? false);
}

export function deriveChannelDisplayState(c: Channel): ChannelDisplayState {
  if (c.gwEnabled === false) return 'disabled';
  if (c.gwConfigured === false) return 'pending-config';
  // Active QR-pairing window (hub-tracked via channels.whatsapp.qr/paired events).
  // Overrides the snapshot, which reads gwRunning=false during pairing (the gateway
  // stops the provider to issue a fresh QR) and would otherwise derive "starting".
  // Guarded by !gwConnected so a lost paired/pairFailed event can't pin it once live.
  if (c.gwPairing === true && c.gwConnected !== true) return 'pairing';
  // An enabled account with no linked session is NOT an error — it just needs
  // pairing. Checked before gwLastError because the gateway sets a lastError
  // while it fails to bring up a credential-less account.
  if (c.gwLinked === false) return 'not-linked';
  // Linked, but to the wrong number (e.g. the Faces phone in PANIK's slot).
  if (c.gwLinked === true && c.gwIdentityMismatch === true) return 'identity-mismatch';
  if (c.gwLastError) return 'error';
  if (c.gwRunning === true && c.gwConnected === false) return 'pairing';
  if (c.gwRunning === false) return 'starting';
  if ((c.gwReconnectAttempts ?? 0) > 0) return 'degraded';
  // History-sync states slot in LAST, just above `live`. Precedence rationale:
  // every connection problem (disabled / pending-config / pairing / not-linked /
  // identity-mismatch / error / starting / degraded) describes a broken or
  // incomplete LINK and must win — a channel that is syncing is by definition
  // linked and running, so reporting "syncing" over an error would hide the real
  // fault. `degraded` (reconnect attempts) also outranks: a flapping socket is
  // the more actionable signal, and it is what stalls the sync in the first place.
  // phase 'idle'/'complete' (and an absent historySync, i.e. older gateways)
  // fall through to `live` — there is no permanent "synced" pill.
  const phase = c.historySync?.phase;
  if (phase === 'stalled') return 'sync-stalled';
  if (phase === 'bootstrap' || phase === 'recent' || phase === 'full' || phase === 'on-demand')
    return 'syncing';
  return 'live';
}
