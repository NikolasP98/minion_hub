import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ChannelSyncStatus from './ChannelSyncStatus.svelte';

const activeSync = {
  phase: 'full' as const,
  progress: 42,
  explicit: false,
  messages: 1200,
  chats: 80,
  startedAt: 1_721_000_000_000,
  updatedAt: 1_721_000_010_000,
};

describe('ChannelSyncStatus', () => {
  it('separates WhatsApp receipt from exact Hub acknowledgements', () => {
    const { body } = render(ChannelSyncStatus, {
      props: {
        sync: activeSync,
        delivery: {
          total: 156_485,
          acknowledged: 69_600,
          pending: 86_885,
          retrying: 0,
          lastAcknowledgedAt: 1_721_000_020_000,
          updatedAt: 1_721_000_020_000,
        },
        accountId: '+51900000000',
      },
    });

    expect(body).toContain('Received from WhatsApp');
    expect(body).toContain('Uploading to Hub');
    expect(body).toContain('Acknowledged by Hub');
    expect(body).toContain('69,600 of 156,485');
    expect(body).toContain('44.5%');
    expect(body).toContain('86,885 pending · 55.5%');
    expect(body).toContain('data-progress-buffer="pending"');
    expect(body).toContain('1,200 messages');
    expect(body).not.toContain('Confirmation unavailable');
  });

  it('does not claim a Hub acknowledgement without gateway delivery data', () => {
    const { body } = render(ChannelSyncStatus, { props: { sync: activeSync } });

    expect(body).toContain('Received from WhatsApp');
    expect(body).not.toContain('Acknowledged by Hub');
    expect(body).not.toContain('Confirmation unavailable');
  });

  it('does not call an active outbox a paused WhatsApp sync', () => {
    const { body } = render(ChannelSyncStatus, {
      props: {
        sync: { ...activeSync, phase: 'stalled' as const },
        delivery: {
          total: 100,
          acknowledged: 75,
          pending: 25,
          retrying: 0,
          lastAcknowledgedAt: 1_721_000_020_000,
          updatedAt: 1_721_000_020_000,
        },
        accountId: '+51900000000',
      },
    });

    expect(body).toContain('Uploading to Hub');
    expect(body).not.toContain('Paused — no data for 2 minutes');
  });
});
