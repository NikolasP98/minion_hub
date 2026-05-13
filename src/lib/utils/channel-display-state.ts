import type { Channel } from '$lib/types/channels';

export type ChannelDisplayState =
  | 'disabled'
  | 'pending-config'
  | 'starting'
  | 'pairing'
  | 'live'
  | 'degraded'
  | 'error';

export function deriveChannelDisplayState(c: Channel): ChannelDisplayState {
  if (c.gwEnabled === false) return 'disabled';
  if (c.gwConfigured === false) return 'pending-config';
  if (c.gwLastError) return 'error';
  if (c.gwRunning === true && c.gwConnected === false) return 'pairing';
  if (c.gwRunning === false) return 'starting';
  if ((c.gwReconnectAttempts ?? 0) > 0) return 'degraded';
  return 'live';
}
