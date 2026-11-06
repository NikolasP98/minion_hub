import { eq, sql, type SQL } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmContacts, crmSettings } from '$server/db/pg-crm-schema';
import {
  icpDefinitionSchema,
  icpDefinitionWriteSchema,
  type IcpDefinition,
  type IcpDefinitionInput,
} from '$lib/components/crm/crm-icp';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  type DepositRule,
} from './crm-deposit-rule';

/**
 * The CRM settings boundary — the ONE place `crm_settings.value` is read.
 *
 * `crm_settings` is a single jsonb row per org whose top-level keys are owned
 * by different features (`accounts` → the CRM account scope,
 * `winAnalysis` → the similarity service, `deposit` → the deposit rule below,
 * `icp` → the ICP definition below).
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

// ── ICP definition (`crm_settings.value.icp`) ───────────────────────────────
// Spec 2026-08-03-crm-icp-score-spec §3.1. The shape, the caps and the strict
// write schema live in `$lib/components/crm/crm-icp` (shared with the client);
// this section owns only the read normalization and the DB round trip, exactly
// as the deposit rule above splits `crm-deposit-rule.ts` from this file.

/**
 * Read normalization for a stored `icp` value.
 *
 * - **Absent** (`undefined`/`null`) ⇒ `null`, silently. Almost every org has
 *   never configured an ICP; that is the default state, not a misconfiguration.
 * - **Malformed** (fails `icpDefinitionSchema`) ⇒ warn once and return `null`
 *   as a WHOLE — never a salvaged subset. A partially-recovered definition
 *   would be scored against and cached per contact under a version the
 *   operator never authored, which is worse than the feature staying off.
 * - **Well-formed** ⇒ the parsed definition.
 *
 * A VALID but empty definition is still returned here; "is the feature on" is
 * `isIcpConfigured`, which the client shares.
 */
export function normalizeIcpDefinition(raw: unknown): IcpDefinition | null {
  if (raw == null) return null;
  const parsed = icpDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `crm_settings.value.icp is malformed (${parsed.error.issues[0]?.message ?? 'invalid'}); treating the org as having no ICP definition`,
    );
    return null;
  }
  return parsed.data;
}

/**
 * Resolves the org's ICP definition — `null` when unset, unparseable, or the
 * settings read itself fails (same ruling as `resolveDepositRule`: the feature
 * going quiet is recoverable, a failed page is not).
 *
 * Opens its own transaction via `readCrmSettingsValue` — never call it from
 * inside another `withOrgCore` (see the transaction-discipline note above).
 */
export async function resolveIcpDefinition(ctx: CoreCtx): Promise<IcpDefinition | null> {
  let value: Record<string, unknown>;
  try {
    value = await readCrmSettingsValue(ctx);
  } catch (err) {
    console.warn('resolveIcpDefinition: crm_settings read failed; treating ICP as unset', err);
    return null;
  }
  return normalizeIcpDefinition(value.icp);
}

/**
 * SQL for "this jsonb expression as a usable version, else 0". Usable = a jsonb
 * NUMBER, integral, in 1..2^53-1. The range and integrality checks run in
 * `numeric` before the `bigint` cast, so a corrupt `1e100` evaluates to 0
 * instead of raising 22003 and leaving the row permanently unsaveable. The
 * nested CASEs (not one AND chain) pin the evaluation order: the `numeric` cast
 * only ever sees a jsonb number.
 */
function validVersionSql(jsonbExpr: SQL): SQL {
  const n = sql`(${jsonbExpr} #>> '{}')::numeric`;
  return sql`(case when jsonb_typeof(${jsonbExpr}) = 'number' then
      (case when ${n} = trunc(${n}) and ${n} between 1 and 9007199254740991
        then ${n}::bigint else 0 end)
    else 0 end)`;
}

/**
 * SQL for the version a save writes, computed by Postgres from the row it is
 * updating — never from a value this process read earlier. `version` is what
 * invalidates every cached per-contact score (spec §3.1, §5), so two concurrent
 * saves must yield two distinct, strictly increasing versions; a read-modify-
 * write loses one and leaves a definition whose version was already scored
 * against.
 *
 * `greatest(storedVersion, highest cached _icp.icpVersion in this org) + 1`: a
 * repaired or malformed definition must never reuse a version a cached verdict
 * was scored against, because the dirty gate is signature-based, not age-based.
 * Pass `stored` as `null` on the insert branch (there is no existing row).
 */
function nextIcpVersionSql(orgId: string, stored: SQL | null): SQL {
  const cachedVersion = sql`select ${validVersionSql(sql`c.custom_fields->'_icp'->'icpVersion'`)} as v
      from ${crmContacts} c
      where c.org_id = ${orgId}`;
  const highestCached = sql`coalesce((select max(cached.v) from (${cachedVersion}) cached), 0)`;
  return stored
    ? sql`(greatest(${validVersionSql(stored)}, ${highestCached}) + 1)`
    : sql`(${highestCached} + 1)`;
}

/**
 * Persist an org's ICP definition, bumping `icp.version` ATOMICALLY.
 *
 * Input is parsed with the STRICT write schema first (over-cap input, unknown
 * keys and a client-supplied `version`/`updatedAt` are rejected, never clamped
 * or trusted). `updatedAt` is stamped here; `version` comes from
 * {@link nextIcpVersionSql} inside the same statement. There is no pre-read:
 * the single upsert is the whole write (spec §6.1).
 *
 * Every save bumps the version, even a no-op edit — cheap over-invalidation
 * beats a silently stale score (spec §3.1, "bump on ANY edit").
 *
 * Only the `icp` path is written (`jsonb_set`), so `accounts`, `deposit` and
 * `winAnalysis` on the same row are never touched. Inside DO UPDATE a bare
 * column reference reads the EXISTING row — the same idiom `persistWinAnalysis`
 * and `persistConfigs` rely on.
 *
 * The `returning` value is re-validated INSIDE the transaction: at safe-integer
 * exhaustion the SQL deliberately writes an out-of-contract successor, and
 * throwing here rolls it back rather than committing an invalid definition or
 * reporting a duplicate version.
 *
 * Opens its own `withOrgCore` — never call it from inside another one.
 *
 * TODO(handoff): no HTTP write path yet — Slice 6 of 2026-08-03-crm-icp-score-spec adds the /crm/settings editor + route (covered by API_WRITE_PREFIXES ['/api/crm','crm'], no new RBAC gate)
 */
export async function saveIcpDefinition(
  ctx: CoreCtx,
  input: IcpDefinitionInput,
): Promise<IcpDefinition> {
  const parsed = icpDefinitionWriteSchema.parse(input);
  const body = JSON.stringify(parsed);
  const updatedAt = new Date().toISOString();
  const stamp = (version: SQL) =>
    sql`${body}::jsonb || jsonb_build_object('updatedAt', ${updatedAt}::text, 'version', ${version})`;

  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(crmSettings)
      .values({
        orgId: ctx.tenantId,
        value: sql`jsonb_build_object('icp', ${stamp(nextIcpVersionSql(ctx.tenantId, null))})`,
      })
      .onConflictDoUpdate({
        target: crmSettings.orgId,
        set: {
          value: sql`jsonb_set(coalesce(${crmSettings.value}, '{}'::jsonb), '{icp}', ${stamp(
            nextIcpVersionSql(ctx.tenantId, sql`${crmSettings.value}->'icp'->'version'`),
          )}, true)`,
          updatedAt: new Date(),
        },
      })
      .returning({ value: crmSettings.value });
    const stored = normalizeIcpDefinition((row?.value as { icp?: unknown } | undefined)?.icp);
    if (!stored) {
      throw new Error(
        'saveIcpDefinition: stored ICP definition did not round-trip; version repair required',
      );
    }
    return stored;
  });
}
