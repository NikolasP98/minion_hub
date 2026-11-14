import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';

/**
 * Sends left in progress by a dead invocation (spec 118 slice 2). Hub functions
 * are capped at 300 s, so a claim older than this belongs to no live request.
 */
export const STALE_SEND_MINUTES = 15;

/**
 * Fails every reminder and door follow-up still `sending`, and every tax
 * emission still `pending`, past the limit — across all organisations and
 * whether or not the feature is switched on, so nothing stays hidden forever.
 * Reaped sends are never re-sent ("a failed send is never retried"); a reaped
 * emission shows as `error`, which the shift history offers to retry.
 * `created_at` is the claim time on both send tables (the reminders trigger
 * freezes it); a `pending` emission's `updated_at` is its insert time.
 */
export async function reapStaleSends(): Promise<{
  reminders: number;
  followups: number;
  emissions: number;
}> {
  const db = getCoreDb();
  const limit = sql`now() - make_interval(mins => ${STALE_SEND_MINUTES})`;
  const reminders = (await db.execute(sql`
    update sched_reminders set status = 'failed', error = 'stale_claim'
    where status = 'sending' and created_at < ${limit}
    returning id
  `)) as unknown as unknown[];
  const followups = (await db.execute(sql`
    update crm_door_followups set status = 'failed', error = 'stale_claim'
    where status = 'sending' and created_at < ${limit}
    returning id
  `)) as unknown as unknown[];
  const emissions = (await db.execute(sql`
    update pos_emissions set status = 'error', response_description = 'stale_pending', updated_at = now()
    where status = 'pending' and updated_at < ${limit}
    returning id
  `)) as unknown as unknown[];
  return { reminders: reminders.length, followups: followups.length, emissions: emissions.length };
}
