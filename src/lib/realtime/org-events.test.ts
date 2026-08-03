import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let broadcastHandler: ((payload: unknown) => void) | null = null;
  let subscribeHandler: ((status: string, error?: Error) => void) | null = null;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, handler: (payload: unknown) => void) => {
      broadcastHandler = handler;
      return channel;
    }),
    subscribe: vi.fn((handler: (status: string, error?: Error) => void) => {
      subscribeHandler = handler;
      return channel;
    }),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
    realtime: { setAuth: vi.fn(async () => {}) },
  };
  return {
    channel,
    client,
    getBroadcastHandler: () => broadcastHandler,
    getSubscribeHandler: () => subscribeHandler,
    resetHandlers: () => {
      broadcastHandler = null;
      subscribeHandler = null;
    },
  };
});

vi.mock('$lib/supabase/client', () => ({
  supabaseBrowser: () => mocks.client,
}));

import { disconnectOrgRealtime, orgRealtimeTopic, subscribeMessageCommitted } from './org-events';

describe('org realtime channel', () => {
  beforeEach(() => {
    disconnectOrgRealtime();
    mocks.resetHandlers();
    vi.clearAllMocks();
  });

  it('shares one private channel and one auth join per org', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeMessageCommitted('org-1', first);
    const unsubscribeSecond = subscribeMessageCommitted('org-1', second);

    await Promise.resolve();

    expect(mocks.client.channel).toHaveBeenCalledTimes(1);
    expect(mocks.client.channel).toHaveBeenCalledWith(orgRealtimeTopic('org-1'), {
      config: { private: true },
    });
    expect(mocks.client.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(mocks.channel.subscribe).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(mocks.client.removeChannel).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('dispatches only valid message.committed payloads', async () => {
    const handler = vi.fn();
    subscribeMessageCommitted('org-1', handler);
    await Promise.resolve();

    mocks.getBroadcastHandler()?.({
      event: 'message.committed',
      payload: {
        version: 1,
        id: 'message-1',
        clientId: 'client-1',
        channel: 'whatsapp',
        accountId: 'account-1',
        chatId: 'chat-1',
        direction: 'inbound',
        occurredAt: '2026-07-25T22:30:00.000Z',
      },
    });
    mocks.getBroadcastHandler()?.({
      event: 'message.committed',
      payload: { version: 1, id: 'incomplete' },
    });
    mocks.getBroadcastHandler()?.({
      event: 'some.future.event',
      payload: {},
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-1' }));
  });

  it('reports private-channel status without creating another channel', async () => {
    const status = vi.fn();
    subscribeMessageCommitted('org-1', vi.fn(), status);
    await Promise.resolve();

    expect(status).toHaveBeenCalledWith('CONNECTING');
    mocks.getSubscribeHandler()?.('SUBSCRIBED');
    expect(status).toHaveBeenLastCalledWith('SUBSCRIBED', undefined);
  });
});
