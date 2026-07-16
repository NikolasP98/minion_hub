import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { validatePendingDnis } from '$server/services/party.service';

/**
 * GET /api/crm/dni-validation/tick — cron entrypoint for ongoing DNI identity
 * validation (PERUDEVS). Mirrors the other ticks: Bearer $CRON_SECRET, fan out
 * over orgs that have person parties with an unvalidated exactly-8-digit DNI,
 * validate up to 25 per org per tick. New CRM entries (site leads, SUSII sync,
 * manual creates) are picked up automatically on the next tick.
 * Wire on netcup: add an hourly crontab line hitting this URL.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) throw error(503, 'PERUDEVS_API_KEY not configured');

  // Cross-org fanout query (bare core db, same pattern as the other ticks).
  const orgs = (await getCoreDb().execute(sql`
    select distinct org_id from parties
    where type = 'person' and doc_number ~ '^[0-9]{8}$'
      and dni_verified = false and metadata->'dni_validation' is null
  `)) as unknown as { org_id: string }[];

  const totals = { orgs: orgs.length, claimed: 0, verified: 0, mismatch: 0, not_found: 0, error: 0 };
  for (const { org_id } of orgs) {
    try {
      const r = await validatePendingDnis({ db: getCoreDb(), tenantId: org_id }, apiKey, 25);
      totals.claimed += r.claimed;
      totals.verified += r.verified;
      totals.mismatch += r.mismatch;
      totals.not_found += r.not_found;
      totals.error += r.error;
    } catch (e) {
      console.error('[dni-validation] tick failed for org', org_id, e);
    }
  }
  return json({ ok: true, ...totals });
};
