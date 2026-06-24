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
  | 'error';

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
  return 'live';
}
