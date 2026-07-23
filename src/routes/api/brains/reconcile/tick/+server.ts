import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import {
  advanceBrainCorpusJobNow,
  ensureWhatsAppReconcileJob,
} from '$server/services/brain-corpus-jobs.service';
import {
  advanceBusinessCorpusJobNow,
  ensureBusinessReconcileJob,
} from '$server/services/brain-business-corpus-jobs.service';

/**
 * Vercel/external cron entrypoint. One durable cursor-bearing reconciliation
 * job exists per org; this request advances it within a bounded budget and the
 * global bg-runtime tick can resume the same job after a timeout/redeploy.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const orgs = (await getCoreDb().execute(
    sql`select id::text as id from organizations order by id`,
  )) as unknown as Array<{ id: string }>;
  const totals = {
    orgs: orgs.length,
    created: 0,
    resumed: 0,
    advanced: 0,
    businessCreated: 0,
    businessResumed: 0,
    businessAdvanced: 0,
    errors: 0,
  };
  for (const { id: orgId } of orgs) {
    try {
      const whatsappJob = await ensureWhatsAppReconcileJob(orgId);
      if (whatsappJob.created) totals.created += 1;
      else totals.resumed += 1;
      await advanceBrainCorpusJobNow(whatsappJob.jobId);
      totals.advanced += 1;

      const businessJob = await ensureBusinessReconcileJob(orgId);
      if (businessJob.created) totals.businessCreated += 1;
      else totals.businessResumed += 1;
      await advanceBusinessCorpusJobNow(businessJob.jobId);
      totals.businessAdvanced += 1;
    } catch (cause) {
      totals.errors += 1;
      console.error('[brain-corpus/reconcile] failed for org', orgId, cause);
    }
  }
  return json({ ok: true, ...totals });
};
