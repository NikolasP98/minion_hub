import { eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { crmSettings } from '$server/db/pg-crm-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { DEFAULT_DEPOSIT_RULE, normalizeDepositRule, type DepositRule } from './crm-deposit-rule';

/**
 * The CRM settings layer — the ONE query path onto `crm_settings.value`, the
 * per-org jsonb KV shared by every CRM feature (`accounts` = harvest scope,
 * `winAnalysis`, `deposit`). Every reader goes through
 * `readCrmSettingsValue` so the graceful-default contract below is honoured
 * in exactly one place instead of being re-implemented per feature.
 */

/**
 * Raw `crm_settings.value` for the org, or `{}`.
 *
 * Graceful default, quoting the migration that created the table
 * (`20260614200000_crm_settings.sql`): *"a missing table OR missing row means
 * 'all channels enabled', so the harvest gate and channel manager are safe
 * even before this migration reaches an environment (the service swallows a
 * missing-relation error)"*. Same behaviour here, generalized: a missing
 * table, a missing row, or any read failure yields an empty settings
 * document, and each feature applies its own default on top.
 *
 * RLS scopes the row by the `app.current_org_id` GUC that `withOrgCore` sets,
 * so this read is org-scoped by the database, not by the `where` alone.
 */
export async function readCrmSettingsValue(ctx: CoreCtx): Promise<Record<string, unknown>> {
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [row] = await tx
        .select({ value: crmSettings.value })
        .from(crmSettings)
        .where(eq(crmSettings.orgId, ctx.tenantId))
        .limit(1);
      return (row?.value ?? {}) as Record<string, unknown>;
    });
  } catch {
    return {};
  }
}

/**
 * The org's deposit-classification rule — what `crm-finance.service.ts`,
 * `crm-contacts.service.ts`, `crm-similarity.service.ts` and
 * `crm-journey.service.ts` each resolve ONCE per call and hand to the pure
 * helpers in `crm-deposit-rule.ts`.
 *
 * Three states, deliberately distinguished:
 *
 * - **absent** (`value.deposit` missing or null) ⇒ `DEFAULT_DEPOSIT_RULE`.
 *   This is every org today, and it must stay byte-identical.
 * - **explicitly empty** (`keywords: []`) ⇒ a rule with no keywords. This org
 *   has no deposit concept: `depositMatchSql` becomes `false`, the journey
 *   milestone never fires, and every invoice line counts as delivered work.
 *   It is a legitimate configuration, NOT a reason to fall back.
 * - **malformed** (wrong shape / non-string members) ⇒ warn and fall back to
 *   the default. FAIL-SOFT ON PURPOSE: these three services back analytics
 *   pages, and one bad settings row must not 500 the whole CRM. Strict
 *   rejection belongs on the WRITE path (`depositWriteSchema`), where a human
 *   is present to fix the input.
 */
export async function resolveDepositRule(ctx: CoreCtx): Promise<DepositRule> {
  const value = await readCrmSettingsValue(ctx);
  const raw = value.deposit;
  if (raw == null) return DEFAULT_DEPOSIT_RULE;
  const rule = normalizeDepositRule(raw);
  if (!rule) {
    console.warn(
      `[crm-settings] org ${ctx.tenantId}: crm_settings.value.deposit is malformed — ` +
        'falling back to the default deposit rule. Fix it through the CRM settings write path.',
    );
    return DEFAULT_DEPOSIT_RULE;
  }
  return rule;
}
