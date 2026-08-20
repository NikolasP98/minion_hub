import { eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmSettings } from '$server/db/pg-crm-schema';
import { DEFAULT_DEPOSIT_RULE, type DepositRule } from './crm-deposit-rule';

/**
 * Per-org deposit-classification settings layer (2026-08-17-hub-reserva-keyword-config-spec
 * S2's `resolveDepositRule` contract) — reads `crm_settings.value.deposit`,
 * same table/row/merge convention as `getCrmSettings`'s `accounts` key
 * (crm-contacts.service.ts) and `getWinAnalysis`'s `winAnalysis` key
 * (crm-similarity.service.ts). Read-only: the write side (settings UI/API,
 * staleness disclosure) remains a canonical S2/S3 decision — this module
 * only resolves the rule finance/contacts need to build their SQL
 * predicates from, normalizing (trim, drop blanks, cap count) and
 * console-warning on malformed input along the way.
 */

// TODO(handoff): MAX_DEPOSIT_KEYWORDS (20) and the console.warn malformed/cap
// signals below are this module's own judgment call, not sourced from the
// canonical 2026-08-17-hub-reserva-keyword-config-spec S2 text (not reachable
// from this checkout/environment). Reconcile against that spec's exact
// normalization-cap and operator-facing-warning contract when it's available,
// and adjust here if it specifies a different bound or delivery mechanism.
/** Upper bound on stored keywords — each becomes a bound ILIKE/NOT ILIKE
 *  clause in every finance/contacts predicate and a component of the finance
 *  cache key, so an unbounded array would grow SQL and cache-key size without
 *  limit. Generous relative to any real deposit-rule vocabulary. */
const MAX_DEPOSIT_KEYWORDS = 20;

/** Absent key, missing row, or a malformed shape all fall back to
 *  DEFAULT_DEPOSIT_RULE — resilient by design, mirroring parseAccountConfigs.
 *  An explicitly stored empty `keywords: []` is NOT malformed and is honored
 *  as-is (a zero-keyword rule matches nothing, by design of depositMatchSql). */
function normalizeDepositRule(raw: unknown): DepositRule {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_DEPOSIT_RULE;
  const o = raw as { keywords?: unknown; label?: unknown };
  if (!Array.isArray(o.keywords)) return DEFAULT_DEPOSIT_RULE;
  const valid = o.keywords
    .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    .map((k) => k.trim());
  if (valid.length !== o.keywords.length) {
    console.warn('crm_settings.value.deposit.keywords dropped non-string/blank entries');
  }
  if (valid.length > MAX_DEPOSIT_KEYWORDS) {
    console.warn(
      `crm_settings.value.deposit.keywords exceeds ${MAX_DEPOSIT_KEYWORDS} entries; truncating`,
    );
  }
  const keywords = valid.slice(0, MAX_DEPOSIT_KEYWORDS);
  const label = typeof o.label === 'string' && o.label.trim() ? o.label : DEFAULT_DEPOSIT_RULE.label;
  return { keywords, label };
}

/** Resolves the normalized DepositRule for one org — call once per
 *  finance/contacts service invocation and reuse the result for every
 *  predicate in that call (never per row/loop iteration). */
export async function resolveDepositRule(ctx: CoreCtx): Promise<DepositRule> {
  try {
    const value = await withOrgCore(ctx, async (tx) => {
      const [row] = await tx
        .select({ value: crmSettings.value })
        .from(crmSettings)
        .where(eq(crmSettings.orgId, ctx.tenantId))
        .limit(1);
      return (row?.value ?? {}) as Record<string, unknown>;
    });
    return normalizeDepositRule(value.deposit);
  } catch (err) {
    console.warn('resolveDepositRule: falling back to DEFAULT_DEPOSIT_RULE after read failure', err);
    return DEFAULT_DEPOSIT_RULE;
  }
}
