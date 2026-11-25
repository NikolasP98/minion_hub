import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  matches: [] as Array<{ p9: string }>,
  scan: vi.fn(),
  advance: vi.fn(),
  module: vi.fn(),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async () => h.matches,
}));
vi.mock('$server/ai-usage', () => ({
  withAiUsageOrg: (_o: string, _s: string, fn: () => unknown) => fn(),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: h.module }));
vi.mock('./reminders.service', () => ({ scanConfirmationReplies: h.scan }));
vi.mock('./reconfirm.service', () => ({ advanceCases: h.advance }));
vi.mock('./reconfirm-answer.service', () => ({ advanceAnswers: vi.fn() }));

import { handleInboundForReminders } from './reminder-reply-trigger.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  h.matches = [];
  h.module.mockResolvedValue(true);
  h.scan.mockResolvedValue({ confirmed: 0, opened: 0, unclear: 0 });
  h.advance.mockResolvedValue({});
});

describe('handleInboundForReminders', () => {
  it('scans only the matching phone group, once, then advances the org cases', async () => {
    h.matches = [{ p9: '999000111' }];
    await handleInboundForReminders(ctx, [
      '51999000111@s.whatsapp.net',
      '51888777666@s.whatsapp.net',
    ]);
    expect(h.scan).toHaveBeenCalledTimes(1);
    expect(h.scan.mock.calls[0]![2]).toEqual({ phones9: ['999000111'] });
    expect(h.advance).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a phone with no booking that got a reminder', async () => {
    await handleInboundForReminders(ctx, ['51999000111@s.whatsapp.net']);
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.advance).not.toHaveBeenCalled();
  });

  it('does nothing when the scheduling module is off', async () => {
    h.matches = [{ p9: '999000111' }];
    h.module.mockResolvedValue(false);
    await handleInboundForReminders(ctx, ['51999000111']);
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('swallows a scan error and logs the error name only', async () => {
    h.matches = [{ p9: '999000111' }];
    h.scan.mockRejectedValue(new TypeError('secret 51999000111 text'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleInboundForReminders(ctx, ['51999000111'])).resolves.toBeUndefined();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('999000111');
    err.mockRestore();
  });
});
