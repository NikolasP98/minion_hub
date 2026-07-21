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
  it('separates WhatsApp receipt from authoritative Hub persistence', () => {
    const { body } = render(ChannelSyncStatus, {
      props: {
        sync: activeSync,
        accountId: '+51900000000',
      },
    });

    expect(body).toContain('Received from WhatsApp');
    expect(body).toContain('Saved to Hub');
    expect(body).toContain('1,200 messages');
    expect(body).toContain('Confirmed from the Hub database');
  });

  it('does not claim database confirmation without an account identity', () => {
    const { body } = render(ChannelSyncStatus, { props: { sync: activeSync } });

    expect(body).toContain('Received from WhatsApp');
    expect(body).not.toContain('Saved to Hub');
  });
});
