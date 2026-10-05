import * as Sentry from '@sentry/sveltekit';

export type NotificationWorkerFailureReason =
  'deadline' | 'statement_timeout' | 'lock_timeout' | 'database_unavailable';

/** Fixed finite reasons only. Never attach SQL, event payloads or the original database error. */
export class NotificationWorkerUnavailable extends Error {
  readonly code = 'notification_worker_unavailable';
  constructor(readonly reason: NotificationWorkerFailureReason) {
    super('Notification processing is temporarily unavailable');
    this.name = 'NotificationWorkerUnavailable';
  }
}

export function notificationWorkerFailure(error: unknown): NotificationWorkerUnavailable | null {
  if (error instanceof NotificationWorkerUnavailable) return error;
  if (!error || typeof error !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const code = descriptor && 'value' in descriptor ? descriptor.value : null;
  if (code === '57014') return new NotificationWorkerUnavailable('statement_timeout');
  if (code === '55P03') return new NotificationWorkerUnavailable('lock_timeout');
  if (
    typeof code === 'string' &&
    (/^08[0-9A-Z]{3}$/.test(code) ||
      [
        '57P01',
        '57P02',
        '57P03',
        '53300',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'CONNECT_TIMEOUT',
        'CONNECTION_CLOSED',
        'CONNECTION_ENDED',
        'CONNECTION_DESTROYED',
      ].includes(code))
  )
    return new NotificationWorkerUnavailable('database_unavailable');
  return null;
}

const lastReported = new Map<NotificationWorkerFailureReason, number>();
export function reportNotificationWorkerFailure(failure: NotificationWorkerUnavailable): void {
  const now = performance.now();
  const previous = lastReported.get(failure.reason);
  if (previous !== undefined && now - previous < 60_000) return;
  lastReported.set(failure.reason, now);
  try {
    Sentry.captureException(new NotificationWorkerUnavailable(failure.reason), {
      tags: { area: 'notifications', code: failure.code, reason: failure.reason },
      fingerprint: ['notifications', failure.code, failure.reason],
    });
  } catch {
    // Observability must not change rollback, queue availability or the surfaced failure.
  }
}
