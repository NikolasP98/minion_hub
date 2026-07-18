import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { isModuleEnabled } from '$server/services/modules.service';
import { analyzeConversationsTick } from '$server/services/crm-conversation-analysis.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/crm/conversations/analyze/tick[?full=1][&limit=120] — cron
 * entrypoint for the incremental CRM conversation analyzer (spec §6). Same
 * fanout/auth shape as the vectorize tick; runs less often (LLM cost) —
 * hourly/daily per the spec's cadence note, wired separately on netcup.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const full = url.searchParams.get('full') === '1';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(120, Number(limitParam) || 0)) : undefined;
  // Only meaningful with full=1 — see vectorize/tick's offset comment.
  const offsetParam = url.searchParams.get('offset');
  const offset = offsetParam ? Math.max(0, Number(offsetParam) || 0) : undefined;

  const orgs = (await getCoreDb().execute(sql`select id from organizations`)) as unknown as { id: string }[];

  const totals = { orgs: 0, processed: 0, dirty: 0, analyzed: 0, failed: 0, remaining: 0, skippedLocked: 0, errors: 0 };
  for (const { id: orgId } of orgs) {
    const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId };
    try {
      if (!(await isModuleEnabled(ctx, 'crm'))) continue;
      totals.orgs += 1;
      const r = await analyzeConversationsTick(ctx, { full, limit, offset });
      if (r.skipped === 'locked') {
        totals.skippedLocked += 1;
        continue;
      }
      totals.processed += r.processed;
      totals.dirty += r.dirty;
      totals.analyzed += r.analyzed;
      totals.failed += r.failed;
      totals.remaining += r.remaining;
    } catch (e) {
      totals.errors += 1;
      console.error('[crm-conversations/analyze/tick] failed for org', orgId, e);
    }
  }
  return json({ ok: true, full, ...totals });
};
