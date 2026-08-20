import { eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmSettings } from '$server/db/pg-crm-schema';
import { DEFAULT_DEPOSIT_RULE, type DepositRule } from './crm-deposit-rule';

/**
 * The CRM settings boundary — the ONE place `crm_settings.value` is read.
 *
 * `crm_settings` is a single jsonb row per org whose top-level keys are owned
 * by different features (`accounts` → the CRM account scope,
 * `winAnalysis` → the similarity service, `deposit` → the deposit rule below).
 * Every consumer reads through `readCrmSettingsValue` and parses only its own
 * key: a second hand-written `select … from crm_settings` is how the org
 * scoping, the missing-row fallback and the transaction discipline drift
 * apart.
 *
 * ## Transaction discipline
 *
 * `readCrmSettingsValue` opens its OWN `withOrgCore` transaction, and the RLS
 * pool defaults to a SINGLE connection (`pg-pool.ts` → `getRlsPgClient`). So
 * this module must never be called from inside another `withOrgCore` callback:
 * the outer transaction owns the only connection while the inner one waits for
 * a second, which is a self-deadlock, not a slow query. Resolve settings
 * BEFORE opening the transaction that needs them and pass the value in.
 */

/**
 * Reads the org's raw `crm_settings.value` object. Missing table/row ⇒ `{}`
 * — callers layer their own per-key fallback on top. Throws only on a real
 * read failure, which each caller handles (settings are never load-bearing
 * enough to fail a page).
 */
export async function readCrmSettingsValue(ctx: CoreCtx): Promise<Record<string, unknown>> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ value: crmSettings.value })
      .from(crmSettings)
      .where(eq(crmSettings.orgId, ctx.tenantId))
      .limit(1);
    return (row?.value ?? {}) as Record<string, unknown>;
  });
}

// ── Deposit rule (`crm_settings.value.deposit`) ─────────────────────────────

/** Upper bound on stored keywords. Each becomes a bound ILIKE/NOT ILIKE clause
 *  in every finance/contacts predicate and a component of the finance and
 *  roster cache keys, so an unbounded array would grow SQL and cache-key size
 *  without limit. */
const MAX_DEPOSIT_KEYWORDS = 20;
/** Upper bound on a single keyword or the label, for the same reason: one
 *  arbitrarily long string is an arbitrarily long SQL parameter. */
const MAX_VALUE_LENGTH = 40;

function warnAndDefault(reason: string): DepositRule {
  console.warn(
    `crm_settings.value.deposit is malformed (${reason}); falling back to DEFAULT_DEPOSIT_RULE`,
  );
  return DEFAULT_DEPOSIT_RULE;
}

/**
 * Read normalization for a stored `deposit` value.
 *
 * - **Absent** (`undefined`/`null`) ⇒ `DEFAULT_DEPOSIT_RULE`, silently. An org
 *   that never configured a rule is not a misconfiguration.
 * - **Malformed** — not an object, `keywords` not an array, ANY non-string
 *   keyword member, or a non-string `label` ⇒ warn and fall back to
 *   `DEFAULT_DEPOSIT_RULE` as a WHOLE. Salvaging the string members of a mixed
 *   array would silently activate a rule the operator never wrote, which is
 *   worse than the known default.
 * - **Well-formed** ⇒ each keyword trimmed, lowercased (ILIKE and
 *   `isDepositText` are both casefolded, so case carries no meaning), truncated
 *   to `MAX_VALUE_LENGTH`, blanks dropped, stable-deduped (first occurrence
 *   wins), capped at `MAX_DEPOSIT_KEYWORDS`. The label is trimmed and truncated;
 *   a blank/absent label falls back to the default label.
 * - **Explicitly empty** `keywords: []` is well-formed and preserved — a
 *   zero-keyword rule matches nothing (`depositMatchSql` ⇒ `false`), which is a
 *   legitimate configuration, NOT an absent key.
 */
export function normalizeDepositRule(raw: unknown): DepositRule {
  if (raw == null) return DEFAULT_DEPOSIT_RULE;
  if (typeof raw !== 'object' || Array.isArray(raw)) return warnAndDefault('not an object');
  const o = raw as { keywords?: unknown; label?: unknown };
  if (!Array.isArray(o.keywords)) return warnAndDefault('keywords is not an array');
  if (o.keywords.some((k) => typeof k !== 'string')) {
    return warnAndDefault('keywords contains a non-string member');
  }
  if (o.label != null && typeof o.label !== 'string') {
    return warnAndDefault('label is not a string');
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  let dropped = false;
  for (const entry of o.keywords as string[]) {
    const k = entry.trim().toLowerCase().slice(0, MAX_VALUE_LENGTH).trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (keywords.length >= MAX_DEPOSIT_KEYWORDS) {
      dropped = true;
      continue;
    }
    keywords.push(k);
  }
  if (dropped) {
    console.warn(
      `crm_settings.value.deposit.keywords exceeds ${MAX_DEPOSIT_KEYWORDS} entries; extra keywords ignored`,
    );
  }
  const label =
    (typeof o.label === 'string' ? o.label.trim().slice(0, MAX_VALUE_LENGTH).trim() : '') ||
    DEFAULT_DEPOSIT_RULE.label;
  return { keywords, label };
}

/**
 * Resolves the normalized `DepositRule` for one org — call ONCE per public
 * finance/contacts service invocation, before opening that call's
 * `withOrgCore` transaction (see the transaction-discipline note above), and
 * reuse the result for every predicate in that call.
 *
 * A read failure warns and falls back to the default: a classification built
 * from the FACES-era default is a known, auditable answer, while a 500 on the
 * CRM roster is not.
 */
export async function resolveDepositRule(ctx: CoreCtx): Promise<DepositRule> {
  let value: Record<string, unknown>;
  try {
    value = await readCrmSettingsValue(ctx);
  } catch (err) {
    console.warn(
      'resolveDepositRule: crm_settings read failed; falling back to DEFAULT_DEPOSIT_RULE',
      err,
    );
    return DEFAULT_DEPOSIT_RULE;
  }
  return normalizeDepositRule(value.deposit);
}
