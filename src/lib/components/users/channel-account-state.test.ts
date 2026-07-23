import { describe, expect, it } from 'vitest';
import { deriveWhatsAppAccountState, matchClaimedAccount } from './channel-account-state';

describe('account connections state', () => {
  it('separates unlinked, claimed, and active integration states', () => {
    expect(deriveWhatsAppAccountState(false, undefined)).toBe('unlinked');
    expect(deriveWhatsAppAccountState(true, undefined)).toBe('claimed');
    expect(
      deriveWhatsAppAccountState(true, {
        accountId: '+51922286663',
        connected: true,
        running: true,
      }),
    ).toBe('sync-active');
  });

  it('matches phone identities across E.164 and WhatsApp jid forms', () => {
    const account = { accountId: '51922286663@s.whatsapp.net', connected: true };
    expect(matchClaimedAccount([account], '+51 922 286 663')).toBe(account);
    expect(matchClaimedAccount([account], '663')).toBeUndefined();
  });

  it('surfaces integration health instead of a generic connected state', () => {
    expect(
      deriveWhatsAppAccountState(true, {
        accountId: '+51922286663',
        running: true,
        connected: false,
      }),
    ).toBe('reconnecting');
    expect(
      deriveWhatsAppAccountState(true, {
        accountId: '+51922286663',
        connected: false,
        lastError: 'socket closed',
      }),
    ).toBe('connection-issue');
  });

  it('treats a draining Hub outbox as syncing, not paused', () => {
    expect(
      deriveWhatsAppAccountState(true, {
        accountId: '+51922286663',
        connected: true,
        historySync: {
          phase: 'stalled',
          progress: null,
          explicit: false,
          messages: 100,
          chats: 10,
          startedAt: 1,
          updatedAt: 2,
        },
        hubSync: {
          total: 100,
          acknowledged: 75,
          pending: 25,
          retrying: 0,
          lastAcknowledgedAt: 2,
          updatedAt: 2,
        },
      }),
    ).toBe('syncing');
  });
});
