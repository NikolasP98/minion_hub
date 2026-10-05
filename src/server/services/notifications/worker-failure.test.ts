import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@sentry/sveltekit', () => ({ captureException: capture }));

beforeEach(() => {
  vi.resetModules();
  capture.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('notification worker failures', () => {
  it('maps database availability failures to fixed reasons without retaining SQL or tenant data', async () => {
    const { notificationWorkerFailure } = await import('./worker-failure');
    for (const [code, reason] of [
      ['57014', 'statement_timeout'],
      ['55P03', 'lock_timeout'],
      ['08006', 'database_unavailable'],
      ['ECONNRESET', 'database_unavailable'],
    ]) {
      const original = Object.assign(new Error('private SQL and notification payload'), { code });
      const failure = notificationWorkerFailure(original);
      expect(failure).toMatchObject({ code: 'notification_worker_unavailable', reason });
      expect(failure?.message).toBe('Notification processing is temporarily unavailable');
      expect(failure).not.toHaveProperty('cause');
      expect(JSON.stringify(failure)).not.toContain('private');
    }
  });

  it('preserves callback errors and does not execute a received code getter', async () => {
    const { notificationWorkerFailure, NotificationWorkerUnavailable } =
      await import('./worker-failure');
    expect(notificationWorkerFailure(new Error('callback failed'))).toBeNull();
    expect(notificationWorkerFailure({ code: '23514' })).toBeNull();
    const getter = vi.fn(() => '57014');
    expect(
      notificationWorkerFailure(Object.defineProperty({}, 'code', { get: getter })),
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    const typed = new NotificationWorkerUnavailable('deadline');
    expect(notificationWorkerFailure(typed)).toBe(typed);
  });

  it('rate limits each finite reason with a monotonic clock and reports only fixed metadata', async () => {
    const { reportNotificationWorkerFailure, NotificationWorkerUnavailable } =
      await import('./worker-failure');
    const now = vi.spyOn(performance, 'now').mockReturnValue(10);
    const failure = new NotificationWorkerUnavailable('statement_timeout');
    reportNotificationWorkerFailure(failure);
    reportNotificationWorkerFailure(failure);
    reportNotificationWorkerFailure(new NotificationWorkerUnavailable('lock_timeout'));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0][0]).not.toBe(failure);
    expect(capture.mock.calls[0][1]).toEqual({
      tags: {
        area: 'notifications',
        code: 'notification_worker_unavailable',
        reason: 'statement_timeout',
      },
      fingerprint: ['notifications', 'notification_worker_unavailable', 'statement_timeout'],
    });
    now.mockReturnValue(60_009);
    reportNotificationWorkerFailure(failure);
    expect(capture).toHaveBeenCalledTimes(2);
    now.mockReturnValue(60_010);
    reportNotificationWorkerFailure(failure);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it('contains observer failures without changing worker error semantics or disabling the rate limit', async () => {
    const { reportNotificationWorkerFailure, NotificationWorkerUnavailable } =
      await import('./worker-failure');
    capture.mockImplementation(() => {
      throw new Error('observer failed');
    });
    const failure = new NotificationWorkerUnavailable('database_unavailable');
    expect(() => reportNotificationWorkerFailure(failure)).not.toThrow();
    expect(() => reportNotificationWorkerFailure(failure)).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(failure.code).toBe('notification_worker_unavailable');
  });
});
