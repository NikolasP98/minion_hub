import { describe, expect, it } from 'vitest';
import { deriveChannelDisplayState, channelOrgVisible } from './channel-display-state';
import type { Channel } from '$lib/types/channels';

describe('channelOrgVisible (cross-org isolation)', () => {
  it('hides a gateway account tagged to a different org', () => {
    expect(channelOrgVisible(['orgB'], 'orgA')).toBe(false);
  });
  it('shows a gateway account tagged to the active org', () => {
    expect(channelOrgVisible(['orgA', 'orgB'], 'orgA')).toBe(true);
  });
  it('hides an untagged account while an org is active (unscoped heartbeat snapshot)', () => {
    expect(channelOrgVisible(undefined, 'orgA')).toBe(false);
    expect(channelOrgVisible([], 'orgA')).toBe(false);
  });
  it('shows everything when no org is active (admin / single-tenant)', () => {
    expect(channelOrgVisible(['orgB'], null)).toBe(true);
    expect(channelOrgVisible(undefined, null)).toBe(true);
  });
});

const base: Channel = {
  id: 'gw:telegram:default',
  serverId: 's1',
  type: 'telegram',
  label: 'bot',
  credentialsMeta: {},
  status: 'active',
  createdAt: 0,
  updatedAt: 0,
};

describe('deriveChannelDisplayState', () => {
  it('returns disabled when gwEnabled is false', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: false })).toBe('disabled');
  });
  it('returns pending-config when configured is false', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: false })).toBe(
      'pending-config',
    );
  });
  it('returns error when lastError present', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwLastError: 'boom',
      }),
    ).toBe('error');
  });
  it('returns not-linked (not error) for an enabled account with no link, even with a lastError', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwLinked: false,
        gwLastError: 'connection failure',
      }),
    ).toBe('not-linked');
  });
  it('returns identity-mismatch when linked to the wrong number', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwLinked: true,
        gwIdentityMismatch: true,
        gwConnected: true,
      }),
    ).toBe('identity-mismatch');
  });
  it('returns live when linked to the correct number', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwLinked: true,
        gwIdentityMismatch: false,
        gwRunning: true,
        gwConnected: true,
      }),
    ).toBe('live');
  });
  it('returns pairing when running but not connected', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwRunning: true,
        gwConnected: false,
      }),
    ).toBe('pairing');
  });
  it('returns starting when not running', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: false }),
    ).toBe('starting');
  });
  it('returns pairing during an active QR window even though the provider is stopped (gwRunning=false)', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwRunning: false,
        gwConnected: false,
        gwPairing: true,
      }),
    ).toBe('pairing');
  });
  it('does NOT pin pairing once connected (stale flag after a lost paired event)', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwRunning: true,
        gwConnected: true,
        gwPairing: true,
      }),
    ).toBe('live');
  });
  it('returns degraded when reconnectAttempts > 0', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwRunning: true,
        gwConnected: true,
        gwReconnectAttempts: 3,
      }),
    ).toBe('degraded');
  });
  it('returns live in the healthy case', () => {
    expect(
      deriveChannelDisplayState({
        ...base,
        gwEnabled: true,
        gwConfigured: true,
        gwRunning: true,
        gwConnected: true,
      }),
    ).toBe('live');
  });
  it('returns live when gw booleans are all undefined (legacy hub-source)', () => {
    expect(deriveChannelDisplayState({ ...base })).toBe('live');
  });
});

describe('deriveChannelDisplayState — history sync', () => {
  const linked: Channel = {
    ...base,
    type: 'whatsapp',
    gwEnabled: true,
    gwConfigured: true,
    gwLinked: true,
    gwRunning: true,
    gwConnected: true,
  };
  const sync = (phase: NonNullable<Channel['historySync']>['phase']) => ({
    phase,
    progress: null,
    explicit: false,
    messages: 0,
    chats: 0,
    startedAt: null,
    updatedAt: 0,
  });

  it.each(['bootstrap', 'recent', 'full', 'on-demand'] as const)(
    'returns syncing for phase %s',
    (phase) => {
      expect(deriveChannelDisplayState({ ...linked, historySync: sync(phase) })).toBe('syncing');
    },
  );

  it('returns sync-stalled for phase stalled', () => {
    expect(deriveChannelDisplayState({ ...linked, historySync: sync('stalled') })).toBe(
      'sync-stalled',
    );
  });

  it.each(['idle', 'complete'] as const)('falls through to live for phase %s', (phase) => {
    expect(deriveChannelDisplayState({ ...linked, historySync: sync(phase) })).toBe('live');
  });

  it('returns syncing while durable Hub delivery still has pending rows', () => {
    expect(
      deriveChannelDisplayState({
        ...linked,
        historySync: sync('complete'),
        hubSync: {
          total: 155_484,
          acknowledged: 98_599,
          pending: 56_885,
          retrying: 0,
          lastAcknowledgedAt: Date.now(),
          updatedAt: Date.now(),
        },
      }),
    ).toBe('syncing');
  });

  it('returns live once durable Hub delivery has no pending rows', () => {
    expect(
      deriveChannelDisplayState({
        ...linked,
        historySync: sync('complete'),
        hubSync: {
          total: 155_484,
          acknowledged: 155_484,
          pending: 0,
          retrying: 0,
          lastAcknowledgedAt: Date.now(),
          updatedAt: Date.now(),
        },
      }),
    ).toBe('live');
  });

  it('regression guard: an undefined historySync changes nothing', () => {
    expect(deriveChannelDisplayState(linked)).toBe('live');
    expect(deriveChannelDisplayState({ ...linked, historySync: undefined })).toBe('live');
    expect(deriveChannelDisplayState({ ...base })).toBe('live');
  });

  // PRECEDENCE: connection problems outrank sync — an errored/unlinked channel
  // must never report syncing even if a stale historySync says so.
  it('does NOT report syncing for an errored channel', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwLastError: 'boom', historySync: sync('recent') }),
    ).toBe('error');
  });
  it('does NOT report syncing for an unlinked channel', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwLinked: false, historySync: sync('recent') }),
    ).toBe('not-linked');
  });
  it('does NOT report syncing for a disabled channel', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwEnabled: false, historySync: sync('recent') }),
    ).toBe('disabled');
  });
  it('does NOT report syncing for an unconfigured channel', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwConfigured: false, historySync: sync('recent') }),
    ).toBe('pending-config');
  });
  it('does NOT report syncing for an identity mismatch', () => {
    expect(
      deriveChannelDisplayState({
        ...linked,
        gwIdentityMismatch: true,
        historySync: sync('recent'),
      }),
    ).toBe('identity-mismatch');
  });
  it('does NOT report sync-stalled during an active QR pairing window', () => {
    expect(
      deriveChannelDisplayState({
        ...linked,
        gwPairing: true,
        gwConnected: false,
        historySync: sync('stalled'),
      }),
    ).toBe('pairing');
  });
  it('does NOT report syncing while still starting', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwRunning: false, historySync: sync('recent') }),
    ).toBe('starting');
  });
  it('degraded outranks syncing (a flapping socket is the more actionable signal)', () => {
    expect(
      deriveChannelDisplayState({ ...linked, gwReconnectAttempts: 2, historySync: sync('recent') }),
    ).toBe('degraded');
  });
});
