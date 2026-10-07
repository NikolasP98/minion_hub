/** Included only in the explicit compiled qualification variant, never in production builds. */
import { env } from '$env/dynamic/private';
import { getPgClient } from '$server/db/pg-pool';
import { UUID_PATTERN } from '$lib/notifications/fields';
import { NOTIFICATION_CATALOG_REVISION } from '$lib/notifications/catalog';
import { NOTIFICATION_PROJECTION_SUPPORT } from '$lib/notifications/projection-manifest';
import type { NotificationProjector } from './projector-contract';
import type { OrganizationLease, RuntimeLease } from './contracts';
import { waitForNotificationTimer } from './owned-timer';

declare const __MINION_NOTIFICATION_QUALIFICATION_SHA__: string;

export async function admitQualificationProjector(
  signal: AbortSignal,
): Promise<NotificationProjector> {
  const url = new URL(env.SUPABASE_DB_URL ?? '');
  const owner = env.MINION_NOTIFICATION_FIXTURE_OWNER ?? '';
  if (
    env.MINION_QC_DISPOSABLE !== '1' ||
    !UUID_PATTERN.test(owner) ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.search ||
    url.hash ||
    url.username !== 'minion_qc' ||
    !/^\/minion_qc_notification_outbox_[a-f0-9]{20}$/.test(url.pathname)
  )
    throw new Error('Notification qualification runtime is not owned');
  const startupDelay = Number(env.MINION_NOTIFICATION_FIXTURE_STARTUP_DELAY_MS ?? '0');
  if (!Number.isInteger(startupDelay) || startupDelay < 0 || startupDelay > 2500)
    throw new Error('Invalid notification qualification startup delay');
  const row = await getPgClient().begin(async (tx) => {
    await tx`select set_config('statement_timeout','3s',true),set_config('lock_timeout','250ms',true)`;
    console.info('[notification-qualification] startup-query-start');
    if (startupDelay) await tx`select pg_sleep(${startupDelay / 1000})`;
    const [identity] = await tx<
      { marker: string | null }[]
    >`select shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`;
    console.info('[notification-qualification] startup-query-finish');
    return identity;
  });
  if (row?.marker !== `minion-notification-scheduler-child:v1:${owner}` || signal.aborted)
    throw new Error('Notification qualification database ownership is unavailable');
  const delay = Number(env.MINION_NOTIFICATION_FIXTURE_DELAY_MS ?? '1');
  const ignoreAbort = env.MINION_NOTIFICATION_FIXTURE_IGNORE_ABORT === '1';
  if (!Number.isInteger(delay) || delay < 1 || delay > 60000)
    throw new Error('Invalid notification qualification delay');
  if (!/^[a-f0-9]{64}$/.test(__MINION_NOTIFICATION_QUALIFICATION_SHA__))
    throw new Error('Notification qualification build provenance is unavailable');
  return Object.freeze({
    revision: 'qualification-only.1',
    sha256: __MINION_NOTIFICATION_QUALIFICATION_SHA__,
    supportedProjectionTuples: NOTIFICATION_PROJECTION_SUPPORT,
    async projectPage(_runtime: RuntimeLease, _lease: OrganizationLease, taskSignal: AbortSignal) {
      console.info('[notification-qualification] projection-start');
      if (ignoreAbort) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      else await waitForNotificationTimer(delay, taskSignal);
      console.info('[notification-qualification] projection-finish');
      // Deliberately leave all source/outbox evidence untouched. This tests owned
      // process scheduling, never delivery or a production projection receipt.
      return { result: 'empty' } as const;
    },
  });
}
