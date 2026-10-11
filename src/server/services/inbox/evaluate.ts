import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { upsertNotification, resolveByKeys } from '$server/services/inbox/inbox.service';
import { INBOX_RULES } from '$server/services/inbox/rules';
import type { CoreCtx } from '$server/auth/core-ctx';

/** Orgs with any scheduling or POS data — the practical stand-in for "POS or
 *  scheduling enabled" (module toggles default to enabled; the rules have
 *  nothing to evaluate for an org with no rows in either table anyway). */
async function listEvaluableOrgIds(): Promise<string[]> {
  const db = getCoreDb();
  const rows = (await db.execute(
    sql`select org_id from sched_resources union select org_id from pos_shifts`,
  )) as unknown as Array<{ org_id: string }>;
  return [...new Set(rows.map((r) => r.org_id))];
}

export interface EvaluateOrgResult {
  orgId: string;
  ok: boolean;
  upserted: number;
  resolved: number;
  error?: string;
}

/** Run every registered rule for one org. Never throws — a rule's own failure
 *  (or the whole org's) is caught and reported, never allowed to abort the
 *  tick for the next org (DoD: per-org isolation). */
async function evaluateOrg(ctx: CoreCtx, now: Date): Promise<EvaluateOrgResult> {
  let upserted = 0;
  let resolved = 0;
  try {
    for (const rule of INBOX_RULES) {
      try {
        const { upserts, resolve } = await rule.evaluate(ctx, now);
        for (const draft of upserts) {
          await upsertNotification(ctx, draft);
          upserted++;
        }
        if (resolve.length > 0) {
          resolved += await resolveByKeys(ctx, resolve);
        }
      } catch (err) {
        console.error('[inbox-evaluate] rule failed', ctx.tenantId, rule.key, err);
      }
    }
    return { orgId: ctx.tenantId, ok: true, upserted, resolved };
  } catch (err) {
    console.error('[inbox-evaluate] org failed', ctx.tenantId, err);
    return {
      orgId: ctx.tenantId,
      ok: false,
      upserted,
      resolved,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Entry point wired into GET /api/jobs/tick. */
export async function evaluateInboxRules(now = new Date()): Promise<EvaluateOrgResult[]> {
  const db = getCoreDb();
  const orgIds = await listEvaluableOrgIds();
  const results: EvaluateOrgResult[] = [];
  for (const orgId of orgIds) {
    results.push(await evaluateOrg({ db, tenantId: orgId }, now));
  }
  return results;
}
