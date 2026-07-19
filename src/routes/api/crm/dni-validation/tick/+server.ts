import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { validatePendingDnis } from '$server/services/party.service';

/** Rows claimed per DB round-trip. Small keeps the `for update skip locked`
 *  claim short-lived; the drain loop is what clears the whole backlog. */
const BATCH = 25;
/** Wall-clock ceiling for one tick. Under the crontab's `curl -m 50`. */
const BUDGET_MS = 40_000;

/**
 * GET /api/crm/dni-validation/tick — cron entrypoint for ongoing DNI identity
 * validation (PERUDEVS). Mirrors the other ticks: Bearer $CRON_SECRET, fan out
 * over orgs that have person parties with an unvalidated exactly-8-digit DNI.
 *
 * DRAINS each org fully rather than stopping at one batch, so a run clears every
 * pending DNI instead of trickling 25/tick. Bounded by a wall-clock budget (the
 * crontab curl uses -m 50) so a fresh org with thousands of rows degrades to
 * "resume next tick" instead of timing out mid-flight; `validatePendingDnis`
 * claims rows transactionally, so a truncated run loses nothing.
 *
 * No pending DNIs ⇒ the fanout selects no orgs ⇒ the run is a no-op.
 * Wire on netcup: add an hourly crontab line hitting this URL.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) throw error(503, 'PERUDEVS_API_KEY not configured');

  // Cross-org fanout query (bare core db, same pattern as the other ticks).
  // MUST mirror validatePendingDnis' claim predicate — it also reclaims rows
  // stranded in 'processing' by a worker that died >5min ago. Selecting only
  // never-attempted rows here would leave an org whose remaining rows are all
  // stranded permanently unselected, so those rows would never be retried.
  const orgs = (await getCoreDb().execute(sql`
    select distinct org_id from parties
    where type = 'person' and doc_number ~ '^[0-9]{8}$'
      and dni_verified = false
      and (metadata->'dni_validation' is null
           or (metadata->'dni_validation'->>'status' = 'processing'
               and updated_at < now() - interval '5 minutes'))
  `)) as unknown as { org_id: string }[];

  const deadline = Date.now() + BUDGET_MS;
  const totals = { orgs: orgs.length, claimed: 0, verified: 0, mismatch: 0, not_found: 0, error: 0 };
  let drained = true;
  for (const { org_id } of orgs) {
    const ctx = { db: getCoreDb(), tenantId: org_id };
    try {
      // Keep claiming batches until this org has nothing pending (r.claimed === 0)
      // or the budget runs out.
      for (;;) {
        if (Date.now() >= deadline) {
          drained = false;
          break;
        }
        const r = await validatePendingDnis(ctx, apiKey, BATCH);
        totals.claimed += r.claimed;
        totals.verified += r.verified;
        totals.mismatch += r.mismatch;
        totals.not_found += r.not_found;
        totals.error += r.error;
        if (r.claimed < BATCH) break; // short batch ⇒ org drained
      }
    } catch (e) {
      console.error('[dni-validation] tick failed for org', org_id, e);
    }
    if (!drained) break;
  }
  return json({ ok: true, drained, ...totals });
};
