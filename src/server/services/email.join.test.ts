import { describe, test, expect, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: {} })); // no RESEND_API_KEY

describe('sendJoinRequestEmail', () => {
  test('no-ops gracefully when RESEND_API_KEY unset', async () => {
    const { sendJoinRequestEmail } = await import('./email.service');
    await expect(
      sendJoinRequestEmail({ to: 'admin@x.io', requesterEmail: 'a@b.c', requesterName: 'A' }),
    ).resolves.toBeUndefined();
  });
});
