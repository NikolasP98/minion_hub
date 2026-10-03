import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  send: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'https://hub.invalid' }));

import { sendJoinRequestEmail } from './email.service';

describe('sendJoinRequestEmail', () => {
  beforeEach(() => {
    delete mocks.env.RESEND_API_KEY;
    delete mocks.env.RESEND_FROM;
    mocks.send.mockReset();
  });

  test('reports missing provider credentials as unavailable', async () => {
    await expect(sendJoinRequestEmail({ to: 'manager@example.test' })).resolves.toEqual({
      accepted: false,
      errorClass: 'unavailable',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test('uses generic external content and reports provider acceptance', async () => {
    mocks.env.RESEND_API_KEY = 'fixture-key';
    mocks.send.mockResolvedValueOnce({ data: { id: 'receipt-1' }, error: null });
    await expect(sendJoinRequestEmail({ to: 'manager@example.test' })).resolves.toEqual({
      accepted: true,
    });
    const message = mocks.send.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(message.to).toBe('manager@example.test');
    expect(message.subject).toBe('New access request on Minion Hub');
    expect(message.html).toContain('A new access request is ready for review');
    expect(message.html).toContain('https://hub.invalid/users/join-requests');
    expect(message.html).not.toContain('requester@example.test');
    expect(message.html).not.toContain('Applicant Name');
    expect(message.html).not.toContain('private message');
  });

  test('classifies provider rejection and thrown transport failure without raw errors', async () => {
    mocks.env.RESEND_API_KEY = 'fixture-key';
    mocks.send
      .mockResolvedValueOnce({ data: null, error: { message: 'raw provider secret' } })
      .mockRejectedValueOnce(new Error('raw transport secret'));
    await expect(sendJoinRequestEmail({ to: 'manager@example.test' })).resolves.toEqual({
      accepted: false,
      errorClass: 'provider_rejected',
    });
    await expect(sendJoinRequestEmail({ to: 'manager@example.test' })).resolves.toEqual({
      accepted: false,
      errorClass: 'transport_error',
    });
  });
});
