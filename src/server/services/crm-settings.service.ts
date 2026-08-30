import { eq, sql, type SQL } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmSettings } from '$server/db/pg-crm-schema';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  depositWriteSchema,
  type DepositConfig,
  type DepositRule,
} from './crm-deposit-rule';
import type { z } from 'zod';

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
 *  without limit. Shared with the strict write schema (`depositWriteSchema`)
 *  so the read clamp and the write rejection cannot drift apart — an operator
 *  can never store a rule that this reader would silently truncate. */
const MAX_DEPOSIT_KEYWORDS = DEPOSIT_KEYWORDS_MAX;
/** Upper bound on a single keyword or the label, for the same reason: one
 *  arbitrarily long string is an arbitrarily long SQL parameter. */
const MAX_VALUE_LENGTH = DEPOSIT_KEYWORD_MAX_LENGTH;

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
 * The stored rule's VERSION stamp (`crm_settings.value.deposit.updatedAt`) —
 * `null` for an org that has never configured one (the built-in default is
 * versionless). Only `writeDepositRule` mints these, from the DB clock, so a
 * caller that snapshots a version and re-reads it later learns whether the
 * rule it classified under is still the live one.
 */
function depositConfigVersion(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const stamp = (raw as { updatedAt?: unknown }).updatedAt;
  return typeof stamp === 'string' ? stamp : null;
}

/** A `resolveDepositRule` result carrying the version the rule was read at. */
export interface VersionedDepositRule {
  rule: DepositRule;
  /** `crm_settings.value.deposit.updatedAt` as stored, or `null`. */
  version: string | null;
}

/**
 * `resolveDepositRule` plus the version stamp of the value it read — for the
 * one caller that classifies rows in one transaction and PUBLISHES them in a
 * later one (`buildWinIndex`): it snapshots the version here and rechecks it
 * under `lockDepositConfig` before writing, so a rule change that lands during
 * its embedding round-trips can never be published as if it were current.
 *
 * A read failure yields `version: null` alongside the default rule. That is
 * deliberately the version an org with NO stored rule has, so a rebuild that
 * fell back to the default can only publish against an org that is still on
 * the default — against a configured org the recheck disagrees and aborts.
 */
export async function resolveDepositRuleWithVersion(ctx: CoreCtx): Promise<VersionedDepositRule> {
  let value: Record<string, unknown>;
  try {
    value = await readCrmSettingsValue(ctx);
  } catch (err) {
    console.warn(
      'resolveDepositRule: crm_settings read failed; falling back to DEFAULT_DEPOSIT_RULE',
      err,
    );
    return { rule: DEFAULT_DEPOSIT_RULE, version: null };
  }
  return {
    rule: normalizeDepositRule(value.deposit),
    version: depositConfigVersion(value.deposit),
  };
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
  return (await resolveDepositRuleWithVersion(ctx)).rule;
}

/** The minimum a transaction handle must expose for the two helpers below —
 *  `withOrgCore`'s `CoreTx` and the test adapters both satisfy it. */
interface ExecTx {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Takes the org's deposit-config lock for the REST of the caller's
 * transaction (`pg_advisory_xact_lock`, released at commit/rollback — same
 * `hashtext('<namespace>:' || org)` convention as `crm-analyze:` in
 * `crm-conversation-analysis.service.ts`).
 *
 * Two paths must hold it, and both wait rather than skip (`_xact_` not
 * `_try_`), because the property being protected is an ordering, not a
 * mutual-exclusion optimisation:
 *
 * - `writeDepositRule` — so its `updatedAt` stamp is taken strictly AFTER any
 *   already-committing publication, which is what makes the `built_at <
 *   updatedAt` staleness test sound.
 * - `buildWinIndex`'s publication — so its version recheck and its upsert are
 *   one indivisible step against a concurrent write.
 *
 * Without it, a rebuild that read rule A can upsert A-derived `bought` values
 * carrying a timestamp NEWER than a rule-B write that landed while it was
 * embedding: semantically stale rows that pass the timestamp test and are
 * reported as fresh.
 */
export async function lockDepositConfig(tx: ExecTx, orgId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('crm-deposit-rule:' || ${orgId}::text))`,
  );
}

/**
 * Reads the stored deposit version INSIDE a caller's transaction (unlike
 * `resolveDepositRuleWithVersion`, which opens its own — see the
 * transaction-discipline note above). Call it after `lockDepositConfig` to
 * compare against a snapshot taken before a long out-of-transaction step.
 */
export async function readDepositConfigVersion(tx: ExecTx, orgId: string): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select value #>> '{deposit,updatedAt}' as version
    from crm_settings where org_id = ${orgId}
  `)) as unknown as Array<{ version: string | null }>;
  return row?.version ?? null;
}

export interface WriteDepositRuleResult {
  rule: DepositRule;
  staleDerived: boolean;
  staleDerivedCount: number;
}

/**
 * Writes `crm_settings.value.deposit` — the validated write path behind
 * `PUT /api/crm/settings` (see `crm-deposit-rule.ts`'s `depositWriteSchema`
 * doc comment for the design pointer). `patch` must already be
 * `depositWriteSchema`-validated (the route does this; `updatedAt` is never
 * client-supplyable and is stamped here).
 *
 * ONE statement does the read-modify-write: `insert ... on conflict do
 * update set value = crm_settings.value || jsonb_build_object('deposit', …)`
 * merges only the `deposit` key so sibling keys (`accounts`,
 * `disabled_channels`, …) survive untouched, and there is no separate
 * select-then-update window for a concurrent writer to land in between.
 *
 * The whole transaction runs under `lockDepositConfig`, and the `updatedAt`
 * stamp is read from the DB clock inside it. That is what makes
 * `staleDerivedCount` (rows whose `built_at` predates this rule) a sound
 * measure rather than a race: a `buildWinIndex` publication either commits
 * BEFORE this stamp is taken (so its rows are counted) or blocks on the lock
 * and then aborts on the version recheck (so its old-rule rows are never
 * published at all).
 *
 * TODO(handoff): a keyword change does not retroactively reclassify rows
 * already materialized into `crm_win_embeddings.bought`/`snippet` — this
 * function surfaces that as `staleDerivedCount`/`staleDerived` in the
 * response and a warn log; nothing here rebuilds those rows. See the
 * deposit-classification config spec's §5 (⚠️ A3) and the matching handoff
 * entry in the meta-repo proposal for the classification config work.
 */
export async function writeDepositRule(
  ctx: CoreCtx,
  patch: z.infer<typeof depositWriteSchema>,
): Promise<WriteDepositRuleResult> {
  return withOrgCore(ctx, async (tx) => {
    // Ordering, not exclusion: everything below must observe every win-index
    // publication that has already committed — see `lockDepositConfig`.
    await lockDepositConfig(tx, ctx.tenantId);

    const [current] = (await tx.execute(sql`
      select value->'deposit' as deposit
      from crm_settings where org_id = ${ctx.tenantId}
    `)) as unknown as Array<{ deposit: unknown }>;
    const currentRule = normalizeDepositRule(current?.deposit);
    const incomingRule = normalizeDepositRule(patch);
    const sameMatchingSemantics =
      [...currentRule.keywords].sort().join('\u0000') ===
      [...incomingRule.keywords].sort().join('\u0000');

    // The version stamp AND the staleness cutoff, taken from the DB clock
    // AFTER the lock. `clock_timestamp()`, never `now()`: `now()` is the
    // TRANSACTION's start time, which precedes the wait on the lock, so a
    // publication that committed during that wait would carry a `built_at`
    // newer than the cutoff and be reported fresh. It must also come from the
    // same clock as `crm_win_embeddings.built_at` (the database's), not from
    // this process's — the two are compared below.
    const [clock] = (await tx.execute(sql`select clock_timestamp() as at`)) as unknown as Array<{
      at: string | Date;
    }>;
    const updatedAt = new Date(clock?.at ?? Date.now()).toISOString();
    const currentVersion = depositConfigVersion(current?.deposit);
    const stored: DepositConfig = {
      ...patch,
      ...(sameMatchingSemantics && currentVersion
        ? { updatedAt: currentVersion }
        : sameMatchingSemantics
          ? {}
          : { updatedAt }),
    };
    const rule = normalizeDepositRule(stored);

    await tx.execute(sql`
      insert into crm_settings (org_id, value, updated_at)
      values (${ctx.tenantId}, jsonb_build_object('deposit', ${JSON.stringify(stored)}::jsonb), ${updatedAt}::timestamptz)
      on conflict (org_id) do update
      set value = coalesce(crm_settings.value, '{}'::jsonb)
            || jsonb_build_object('deposit', ${JSON.stringify(stored)}::jsonb),
          updated_at = ${updatedAt}::timestamptz
    `);

    if (sameMatchingSemantics) {
      return { rule, staleDerived: false, staleDerivedCount: 0 };
    }

    const [row] = (await tx.execute(sql`
      select count(*)::int as count
      from crm_win_embeddings
      where org_id = ${ctx.tenantId} and built_at < ${updatedAt}::timestamptz
    `)) as unknown as Array<{ count: number }>;
    const staleDerivedCount = row?.count ?? 0;

    if (staleDerivedCount > 0) {
      console.warn(
        `crm-settings: deposit rule changed for org ${ctx.tenantId}; ${staleDerivedCount} ` +
          `crm_win_embeddings row(s) were classified under the previous rule and are now stale ` +
          `(bought/snippet not rebuilt — reclassifying history is out of scope, see the ` +
          `deposit-classification config spec §5)`,
      );
    }

    return { rule, staleDerived: staleDerivedCount > 0, staleDerivedCount };
  });
}
