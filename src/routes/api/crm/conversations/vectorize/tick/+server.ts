import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { isModuleEnabled } from '$server/services/modules.service';
import { vectorizeTick } from '$server/services/crm-conversation-vectors.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/crm/conversations/vectorize/tick[?full=1][&batch=200] — cron
 * entrypoint for the incremental CRM conversation vectorizer (spec §6).
 * Mirrors the other ticks (dni-validation, meta/sync): Bearer $CRON_SECRET,
 * fan out over orgs with the crm module enabled, one batch per org per call.
 * Idempotent — safe to hit repeatedly; `?full=1` is the weekly reconcile.
 * Wire on netcup: crontab every 15–30 min (hot) + weekly with `?full=1`.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const full = url.searchParams.get('full') === '1';
  const batchParam = url.searchParams.get('batch');
  const batch = batchParam ? Math.max(1, Math.min(1000, Number(batchParam) || 0)) : undefined;
  // Only meaningful with full=1 — a full reconcile re-selects the whole corpus
  // every call, so a self-chaining cron pages through it via offset.
  const offsetParam = url.searchParams.get('offset');
  const offset = offsetParam ? Math.max(0, Number(offsetParam) || 0) : undefined;

  const orgs = (await getCoreDb().execute(sql`select id from organizations`)) as unknown as { id: string }[];

  const totals = { orgs: 0, processed: 0, dirty: 0, remaining: 0, skippedLocked: 0, errors: 0 };
  for (const { id: orgId } of orgs) {
    const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId };
    try {
      if (!(await isModuleEnabled(ctx, 'crm'))) continue;
      totals.orgs += 1;
      const r = await vectorizeTick(ctx, { full, batch, offset });
      if (r.skipped === 'locked') {
        totals.skippedLocked += 1;
        continue;
      }
      totals.processed += r.processed;
      totals.dirty += r.dirty;
      totals.remaining += r.remaining;
    } catch (e) {
      totals.errors += 1;
      console.error('[crm-conversations/vectorize/tick] failed for org', orgId, e);
    }
  }
  return json({ ok: true, full, ...totals });
};
