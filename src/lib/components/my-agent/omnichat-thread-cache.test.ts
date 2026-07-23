import { describe, expect, it } from 'vitest';
import {
  LatestThreadRequests,
  mergeServerThread,
  settleOptimisticMessage,
  type OmnichatThreadMessage,
} from './omnichat-thread-cache';

const message = (
  clientId: string,
  overrides: Partial<OmnichatThreadMessage> = {},
): OmnichatThreadMessage => ({
  clientId,
  direction: 'outbound',
  content: clientId,
  senderName: null,
  occurredAt: null,
  ...overrides,
});

describe('omnichat thread cache isolation', () => {
  it('settles only the captured conversation snapshot', () => {
    const firstConversation = [message('reply-a', { pending: true })];
    const secondConversation = [message('reply-b', { pending: true })];

    const settledFirst = settleOptimisticMessage(firstConversation, 'reply-a', false);

    expect(settledFirst).toEqual([message('reply-a', { pending: false })]);
    expect(secondConversation).toEqual([message('reply-b', { pending: true })]);
  });

  it('keeps optimistic messages from the matching cache while merging a refresh', () => {
    const server = [message('persisted', { direction: 'inbound' })];
    const cached = [
      message('optimistic', { pending: true }),
      message('failed', { pending: false, failed: true }),
      message('already-echoed', { pending: true }),
    ];
    const echoed = message('already-echoed');

    expect(mergeServerThread([...server, echoed], cached)).toEqual([
      ...server,
      echoed,
      message('optimistic', { pending: true }),
      message('failed', { pending: false, failed: true }),
    ]);
  });
});

describe('LatestThreadRequests', () => {
  it('does not let an older same-thread request finish the newer loading state', () => {
    const requests = new LatestThreadRequests();
    const older = requests.begin('whatsapp:one');
    const newer = requests.begin('whatsapp:one');

    expect(requests.finish('whatsapp:one', older)).toBe(false);
    expect(requests.isLatest('whatsapp:one', newer)).toBe(true);
    expect(requests.finish('whatsapp:one', newer)).toBe(true);
  });

  it('tracks concurrent conversations independently', () => {
    const requests = new LatestThreadRequests();
    const first = requests.begin('whatsapp:one');
    const second = requests.begin('telegram:two');

    expect(requests.finish('whatsapp:one', first)).toBe(true);
    expect(requests.isLatest('telegram:two', second)).toBe(true);
  });
});
