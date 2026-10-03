import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sanitizeEventProperties } from '$lib/server/observability-context';
const capture = vi.hoisted(() => ({ event: vi.fn(), exception: vi.fn() }));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: capture.event }));
vi.mock('@sentry/sveltekit', () => ({ captureException: capture.exception }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['performance'] });
  capture.event.mockReset();
  capture.exception.mockReset();
});
afterEach(() => vi.useRealTimers());

it('samples only eight finite phase slots and contains monitoring failures', async () => {
  const { recordNotificationMetric } = await import('./telemetry');
  for (const phase of [
    'leader',
    'standby',
    'heartbeat',
    'discovery',
    'projection',
    'admission',
    'health',
    'shutdown',
  ] as const) {
    for (let n = 0; n < 100; n++) recordNotificationMetric(phase, 'ok', n, n);
  }
  expect(capture.event).toHaveBeenCalledTimes(8);
  expect(capture.event.mock.calls.every(([value]) => value.distinctId === 'server')).toBe(true);
  vi.advanceTimersByTime(60000);
  capture.event.mockImplementation(() => {
    throw new Error('SDK unavailable');
  });
  expect(() => recordNotificationMetric('health', 'stale', 20)).not.toThrow();
  expect(capture.event).toHaveBeenCalledTimes(9);
});

it('bounds numeric samples and rejects runtime-invalid categories before they allocate rate slots', async () => {
  const { recordNotificationMetric } = await import('./telemetry');
  recordNotificationMetric('health', 'runnable', -1, 990000, true);
  const event = capture.event.mock.calls[0][0];
  expect(event).toEqual({
    event: 'notification_worker',
    distinctId: 'server',
    properties: {
      notification_phase: 'health',
      notification_outcome: 'runnable',
      duration_ms: 0,
      notification_count: 5000,
      notification_lower_bound: true,
    },
  });
  for (let i = 0; i < 100; i++) recordNotificationMetric(`hostile-${i}` as never, 'ok');
  recordNotificationMetric('projection', 'customer@example.com' as never);
  expect(capture.event).toHaveBeenCalledOnce();
});

it('allows only notification operational fields at the shared capture boundary', () => {
  const safe = {
    notification_phase: 'discovery',
    notification_outcome: 'ok',
    duration_ms: 200,
    notification_count: 4,
    notification_lower_bound: false,
  };
  expect(
    sanitizeEventProperties(
      {
        ...safe,
        org_id: 'org_1',
        actor_id: 'u1',
        error_message: 'customer payload',
        sql_statement: 'select payload from private_table',
      },
      'notification_worker',
    ),
  ).toEqual(safe);
  expect(
    sanitizeEventProperties(
      {
        notification_phase: 'invented',
        notification_outcome: 'invented',
        notification_count: -1,
        notification_lower_bound: 'yes',
      },
      'notification_worker',
    ),
  ).toEqual({});
});

it('reports invariant failures with finite reasons and no raw details, once per minute', async () => {
  const { reportNotificationLoopFailure } = await import('./telemetry');
  // Both dynamic imports share the fresh constructor, as the production module does.
  const { NotificationSchedulerUnavailable: CurrentInvariant } = await import('./contracts');
  const original = new CurrentInvariant('generation_exhausted');
  original.message = 'raw customer@example.com query detail';
  reportNotificationLoopFailure(original);
  reportNotificationLoopFailure(original);
  expect(capture.exception).toHaveBeenCalledOnce();
  expect(capture.exception.mock.calls[0][0].message).not.toContain('customer');
  expect(capture.exception.mock.calls[0][1]).toEqual({
    tags: {
      area: 'notifications',
      code: 'notification_scheduler_unavailable',
      reason: 'generation_exhausted',
    },
    fingerprint: ['notifications', 'notification_scheduler_unavailable', 'generation_exhausted'],
  });
  vi.advanceTimersByTime(60000);
  capture.exception.mockImplementation(() => {
    throw new Error('SDK unavailable');
  });
  expect(() => reportNotificationLoopFailure(original)).not.toThrow();
  expect(capture.exception).toHaveBeenCalledTimes(2);
});

it('does not leak unknown database errors into Sentry or fabricate a cause', async () => {
  const { reportNotificationLoopFailure } = await import('./telemetry');
  reportNotificationLoopFailure(new Error('SQL customer@example.com private data'));
  const [error, context] = capture.exception.mock.calls[0];
  expect(error.message).toBe('Notification scheduler operation failed');
  expect(context.tags.code).toBe('unexpected_scheduler_failure');
  expect(JSON.stringify(context)).not.toContain('customer');
});
