import type { OwnedWorkerService } from '$server/worker-lifecycle';
import {
  acquireRuntimeLease,
  heartbeatRuntimeLease,
  publishAdmissionObservation,
  releaseRuntimeLease,
} from './runtime-lease';
import {
  abandonUnstartedOrganizationLease,
  isOrganizationLeaseLive,
  completeOrganizationLease,
  renewOrganizationLease,
} from './organization-lease';
import { NotificationCoordinatorBusy } from './contention';
import { discoverNotificationOrganizations } from './discovery';
import { waitForNotificationTimer, notificationBackoff } from './owned-timer';
import type {
  OrganizationFailure,
  OrganizationLease,
  OrganizationResult,
  RuntimeLease,
} from './contracts';
import type { NotificationAdmission, NotificationProjector } from './projector-contract';
import { notificationWorkerFailure, reportNotificationWorkerFailure } from '../worker-failure';
import {
  recordNotificationMetric,
  reportNotificationLoopFailure as reportFailure,
} from './telemetry';

/** Internal engine. Production bootstrap supplies the compiled admission adapter. */
export function createNotificationWorkerLoop(
  admit: (signal: AbortSignal) => Promise<NotificationAdmission>,
): OwnedWorkerService {
  const stop = new AbortController();
  const active = new Set<Promise<void>>();
  let bootstrap: Promise<void>;

  async function processOrganization(
    runtime: RuntimeLease,
    initial: OrganizationLease,
    projector: NotificationProjector,
    leader: AbortSignal,
  ) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    leader.addEventListener('abort', cancel, { once: true });
    if (leader.aborted) cancel();
    const taskStarted = performance.now();
    let interruption: OrganizationFailure | null = null;
    let lease = initial;
    const remaining = initial.hardDeadlineMonotonic - performance.now();
    let deadlineReached = remaining <= 0;
    if (deadlineReached) controller.abort();
    const hardStop = waitForNotificationTimer(
      Math.max(1, Math.min(60000, remaining)),
      controller.signal,
    ).then((elapsed) => {
      if (elapsed) {
        deadlineReached = true;
        controller.abort();
      }
    });
    const renewal = (async () => {
      if (!(await waitForNotificationTimer(20000, controller.signal))) return;
      try {
        const renewed = await renewOrganizationLease(runtime, lease);
        if (renewed) lease = renewed;
        else {
          interruption = 'projection_failed';
          controller.abort();
        }
      } catch (error) {
        reportFailure(error);
        interruption = notificationWorkerFailure(error)?.reason ?? 'projection_failed';
        controller.abort();
      }
    })();
    let result: OrganizationResult | null = null;
    try {
      if (!controller.signal.aborted)
        result = await projector.projectPage(lease, controller.signal);
    } catch (error) {
      const known = notificationWorkerFailure(error);
      if (known) reportNotificationWorkerFailure(known);
      else reportFailure(error);
      result = { result: 'failed', reason: known?.reason ?? 'projection_failed' };
    } finally {
      controller.abort();
      // Renewal SQL can already be running; cancellation only removes its timer.
      await renewal;
      await hardStop;
      leader.removeEventListener('abort', cancel);
    }
    if (deadlineReached || performance.now() >= initial.hardDeadlineMonotonic)
      interruption = 'deadline';
    if (interruption && result) result = { result: 'failed', reason: interruption };
    recordNotificationMetric(
      'projection',
      result?.result ?? 'failed',
      performance.now() - taskStarted,
    );
    if (result && !leader.aborted) {
      try {
        await completeOrganizationLease(runtime, lease, result);
      } catch (error) {
        reportFailure(error);
      }
    }
  }

  /** Cleanup admission is deliberately not cancelled by shutdown. An ambiguous
   * write cannot release ownership until SQL proves this exact claim is gone. */
  async function settleUnstartedClaim(runtime: RuntimeLease, lease: OrganizationLease) {
    const cleanup = new AbortController();
    let failures = 0;
    while (true) {
      let delay = 1000;
      try {
        if (await abandonUnstartedOrganizationLease(runtime, lease)) return;
        if (!(await isOrganizationLeaseLive(runtime, lease))) return;
        failures = 0;
      } catch (error) {
        reportFailure(error);
        // Reconcile even an ambiguous COMMIT before retrying its exact receipt.
        try {
          if (!(await isOrganizationLeaseLive(runtime, lease))) return;
        } catch (reconciliationError) {
          reportFailure(reconciliationError);
        }
        delay = notificationBackoff(failures++);
      }
      await waitForNotificationTimer(delay, cleanup.signal);
    }
  }

  async function lead(runtime: RuntimeLease, projector: NotificationProjector) {
    recordNotificationMetric('leader', 'ok');
    const leadership = new AbortController();
    const cancel = () => leadership.abort();
    stop.signal.addEventListener('abort', cancel, { once: true });
    if (stop.signal.aborted) cancel();
    const signal = leadership.signal;
    const heartbeat = (async () => {
      while (await waitForNotificationTimer(5000, signal)) {
        try {
          const renewed = await heartbeatRuntimeLease(runtime);
          if (!renewed) {
            leadership.abort();
            break;
          }
          runtime = renewed;
          recordNotificationMetric('heartbeat', 'ok');
        } catch (error) {
          reportFailure(error);
          if (error instanceof NotificationCoordinatorBusy) continue;
          leadership.abort();
          break;
        }
      }
    })();
    try {
      let failures = 0;
      while (!signal.aborted) {
        let delay = 1000;
        if (active.size < 4) {
          try {
            const discoveryStarted = performance.now();
            const found = await discoverNotificationOrganizations(
              runtime,
              projector.supportedCatalogRevisions,
              4 - active.size,
              signal,
            );
            recordNotificationMetric(
              'discovery',
              found.state === 'lease_lost'
                ? 'lost'
                : found.state === 'coordinator_busy'
                  ? 'busy'
                  : 'ok',
              performance.now() - discoveryStarted,
              found.leases.length,
            );
            failures = 0;
            if (found.state === 'lease_lost') {
              leadership.abort();
              break;
            }
            for (const lease of found.leases) {
              if (signal.aborted) {
                await settleUnstartedClaim(runtime, lease);
                continue;
              }
              const task = processOrganization(runtime, lease, projector, signal);
              active.add(task);
              void task.then(
                () => active.delete(task),
                (error) => {
                  active.delete(task);
                  reportFailure(error);
                },
              );
            }
          } catch (error) {
            reportFailure(error);
            delay = notificationBackoff(failures++);
          }
        }
        if (!(await waitForNotificationTimer(delay, signal))) break;
      }
    } finally {
      leadership.abort();
      await heartbeat;
      while (active.size) await Promise.allSettled([...active]);
      try {
        await releaseRuntimeLease(runtime);
      } catch (error) {
        reportFailure(error);
      }
      stop.signal.removeEventListener('abort', cancel);
    }
  }

  async function run() {
    let failures = 0;
    while (!stop.signal.aborted) {
      try {
        const admission = await admit(stop.signal);
        if (stop.signal.aborted) break;
        if (admission.state === 'failed') {
          recordNotificationMetric('admission', admission.observation.code);
          await publishAdmissionObservation(admission.observation);
          failures = 0;
          if (
            !(await waitForNotificationTimer(30000 + Math.floor(Math.random() * 3000), stop.signal))
          )
            break;
          continue;
        }
        while (!stop.signal.aborted) {
          const result = await acquireRuntimeLease(admission.identity);
          if (result.state === 'acquired') {
            if (stop.signal.aborted) await releaseRuntimeLease(result.lease);
            else await lead(result.lease, admission.projector);
            break; // Next admission receives a fresh process-attempt owner identity.
          }
          failures = 0;
          recordNotificationMetric('standby', 'busy');
          if (
            !(await waitForNotificationTimer(
              result.retryAfterMs + Math.floor(Math.random() * 500),
              stop.signal,
            ))
          )
            break;
        }
        failures = 0;
      } catch (error) {
        reportFailure(error);
        if (!(await waitForNotificationTimer(notificationBackoff(failures++), stop.signal))) break;
      }
    }
  }
  // Register the owner before admission gets its first asynchronous continuation.
  bootstrap = Promise.resolve().then(run);
  void bootstrap.catch(reportFailure);
  return Object.freeze({
    quiesce: () => stop.abort(),
    drain: async () => {
      const started = performance.now();
      stop.abort();
      await bootstrap;
      while (active.size) await Promise.allSettled([...active]);
      recordNotificationMetric('shutdown', 'ok', performance.now() - started);
    },
  });
}
