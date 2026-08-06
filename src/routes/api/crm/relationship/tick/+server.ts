import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  relationshipInferenceTick,
  GLOBAL_CAP,
  WALL_CLOCK_BUDGET_MS,
} from '$server/services/crm-relationship-inference.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * GET /api/crm/relationship/tick — cron entrypoint for the CRM relationship-
 * graph inference tick (spec 2026-07-23 WP3). Same auth/fanout shape as the
 * conversation analyze tick, with two deltas: (1) the org candidate set is
 * filtered to `kind='personal'` in SQL (spec R7 — AI inference is personal-
 * org-only in v1; business orgs get manual labels only) — `crm-relationship-
 * inference.service.ts` rechecks kind itself too, fail-closed; (2) a global
 * per-tick contact budget + wall-clock deadline are threaded through every
 * org so one slow/large org can't starve every other org's turn or blow past
 * the tick's cost ceiling.
 *
 * Deploy note: this route must be crontabbed separately (not automatic from
 * landing this code) — see the implementation report for the exact line.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  const orgs = (await getCoreDb().execute(
    sql`select id from organizations where kind = 'personal'`,
  )) as unknown as { id: string }[];

  const totals = {
    orgs: 0,
    claimed: 0,
    processed: 0,
    skippedPinned: 0,
    skippedCollision: 0,
    unknown: 0,
    failed: 0,
    errors: 0,
  };
  let remainingBudget = GLOBAL_CAP;
  for (const { id: orgId } of orgs) {
    if (remainingBudget <= 0 || Date.now() >= deadline) break;
    const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId };
    try {
      if (!(await isModuleEnabled(ctx, 'crm'))) continue;
      totals.orgs += 1;
      const r = await relationshipInferenceTick(ctx, { remainingBudget, deadline });
      totals.claimed += r.claimed;
      totals.processed += r.processed;
      totals.skippedPinned += r.skippedPinned;
      totals.skippedCollision += r.skippedCollision;
      totals.unknown += r.unknown;
      totals.failed += r.failed;
      remainingBudget -= r.claimed;
    } catch (e) {
      totals.errors += 1;
      console.error('[crm-relationship/tick] failed for org', orgId, e);
    }
  }
  return json({ ok: true, ...totals });
};
