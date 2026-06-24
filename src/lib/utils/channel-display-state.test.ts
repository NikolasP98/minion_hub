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
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: false })).toBe('pending-config');
  });
  it('returns error when lastError present', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwLastError: 'boom' })).toBe('error');
  });
  it('returns not-linked (not error) for an enabled account with no link, even with a lastError', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwLinked: false, gwLastError: 'connection failure' }),
    ).toBe('not-linked');
  });
  it('returns identity-mismatch when linked to the wrong number', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwLinked: true, gwIdentityMismatch: true, gwConnected: true }),
    ).toBe('identity-mismatch');
  });
  it('returns live when linked to the correct number', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwLinked: true, gwIdentityMismatch: false, gwRunning: true, gwConnected: true }),
    ).toBe('live');
  });
  it('returns pairing when running but not connected', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: true, gwConnected: false })).toBe('pairing');
  });
  it('returns starting when not running', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: false })).toBe('starting');
  });
  it('returns pairing during an active QR window even though the provider is stopped (gwRunning=false)', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: false, gwConnected: false, gwPairing: true }),
    ).toBe('pairing');
  });
  it('does NOT pin pairing once connected (stale flag after a lost paired event)', () => {
    expect(
      deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: true, gwConnected: true, gwPairing: true }),
    ).toBe('live');
  });
  it('returns degraded when reconnectAttempts > 0', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: true, gwConnected: true, gwReconnectAttempts: 3 })).toBe('degraded');
  });
  it('returns live in the healthy case', () => {
    expect(deriveChannelDisplayState({ ...base, gwEnabled: true, gwConfigured: true, gwRunning: true, gwConnected: true })).toBe('live');
  });
  it('returns live when gw booleans are all undefined (legacy hub-source)', () => {
    expect(deriveChannelDisplayState({ ...base })).toBe('live');
  });
});
