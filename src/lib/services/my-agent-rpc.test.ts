import { describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('./gateway-rpc', () => ({ sendRequest: send }));

import { draftEmailReply, getEmailSummary } from './my-agent-rpc';

const premium = Object.assign(new Error('forbidden'), {
  code: 'FORBIDDEN',
  details: { reason: 'premium_required' },
});

describe('email AI on a premium_required answer (spec 043)', () => {
  it('summary and draft resolve to null instead of throwing', async () => {
    send.mockImplementation(async () => {
      throw premium;
    });
    await expect(getEmailSummary('m1')).resolves.toBeNull();
    await expect(draftEmailReply('m1')).resolves.toBeNull();
  });
  it('other failures still throw', async () => {
    send.mockImplementation(async () => {
      throw new Error('timeout');
    });
    await expect(getEmailSummary('m1')).rejects.toThrow('timeout');
    await expect(draftEmailReply('m1')).rejects.toThrow('timeout');
  });
  it('a normal answer is unchanged', async () => {
    send.mockResolvedValue({ summary: 'S', draft: 'D' });
    await expect(getEmailSummary('m1')).resolves.toBe('S');
    await expect(draftEmailReply('m1')).resolves.toBe('D');
  });
});
