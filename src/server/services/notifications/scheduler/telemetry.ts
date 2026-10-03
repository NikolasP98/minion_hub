import { captureServerEvent } from '$lib/server/posthog';
import { NotificationSchedulerUnavailable } from './contracts';
import * as Sentry from '@sentry/sveltekit';
import { notificationWorkerFailure, reportNotificationWorkerFailure } from '../worker-failure';

let lastUnexpected = -Infinity;
const lastInvariant = new Map<NotificationSchedulerUnavailable['reason'], number>();

/** Unknown failures stay unknown; neither raw errors nor invented DB diagnoses reach telemetry. */
export function reportNotificationLoopFailure(error: unknown): void {
  if (error instanceof NotificationSchedulerUnavailable) {
    const now = performance.now();
    if (now - (lastInvariant.get(error.reason) ?? -Infinity) < 60000) return;
    lastInvariant.set(error.reason, now);
    try {
      Sentry.captureException(new NotificationSchedulerUnavailable(error.reason), {
        tags: { area: 'notifications', code: error.code, reason: error.reason },
        fingerprint: ['notifications', error.code, error.reason],
      });
    } catch {
      /* Monitoring never changes ownership or the failure. */
    }
    return;
  }
  const known = notificationWorkerFailure(error);
  if (known) {
    reportNotificationWorkerFailure(known);
    return;
  }
  const now = performance.now();
  if (now - lastUnexpected < 60000) return;
  lastUnexpected = now;
  try {
    Sentry.captureException(new Error('Notification scheduler operation failed'), {
      tags: { area: 'notifications', code: 'unexpected_scheduler_failure' },
      fingerprint: ['notifications', 'unexpected_scheduler_failure'],
    });
  } catch {
    // Monitoring cannot release a task, manufacture a receipt or break cleanup.
  }
}

const METRIC_PHASES = [
  'leader',
  'standby',
  'heartbeat',
  'discovery',
  'projection',
  'admission',
  'health',
  'shutdown',
] as const;
const METRIC_OUTCOMES = [
  'ok',
  'busy',
  'lost',
  'failed',
  'completed',
  'empty',
  'unsupported',
  'runnable',
  'stale',
  'absent',
  'catalog_invalid',
  'catalog_mismatch',
  'projection_unavailable',
  'build_unavailable',
  'startup_failed',
] as const;
export type NotificationMetricPhase = (typeof METRIC_PHASES)[number];
export type NotificationMetricOutcome = (typeof METRIC_OUTCOMES)[number];
const metricLast = new Map<NotificationMetricPhase, number>();
/** Eight fixed sample slots, at most one event per phase per minute, no tenant or payload fields. */
export function recordNotificationMetric(
  phase: NotificationMetricPhase,
  outcome: NotificationMetricOutcome,
  durationMs = 0,
  count = 0,
  lowerBound = false,
): void {
  if (
    !METRIC_PHASES.includes(phase) ||
    !METRIC_OUTCOMES.includes(outcome) ||
    typeof lowerBound !== 'boolean'
  )
    return;
  const now = performance.now();
  if (now - (metricLast.get(phase) ?? -Infinity) < 60000) return;
  metricLast.set(phase, now);
  try {
    captureServerEvent({
      event: 'notification_worker',
      distinctId: 'server',
      properties: {
        notification_phase: phase,
        notification_outcome: outcome,
        duration_ms: Math.min(86400000, Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)),
        notification_count: Math.min(
          5000,
          Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0),
        ),
        notification_lower_bound: lowerBound,
      },
    });
  } catch {
    /* Capture is observational and never owns a task. */
  }
}
