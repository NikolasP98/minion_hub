import { eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmSettings } from '$server/db/pg-crm-schema';
import {
  DEFAULT_DEPOSIT_RULE,
  DEPOSIT_KEYWORDS_MAX,
  DEPOSIT_KEYWORD_MAX_LENGTH,
  type DepositRule,
} from './crm-deposit-rule';
import {
  icpDefinitionSchema,
  icpDefinitionWriteSchema,
  type IcpDefinition,
  type IcpDefinitionInput,
} from '$lib/components/crm/crm-icp';

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
// Spec 2026-08-03-crm-icp-score-spec §3.1. The SHAPE, the caps and the strict
// write schema live in `$lib/components/crm/crm-icp` (shared with the client);
// this section owns only the read normalization and the DB round trip, exactly
// as the deposit rule above splits `crm-deposit-rule.ts` from this file.

/**
 * Read normalization for a stored `icp` value.
 *
 * - **Absent** (`undefined`/`null`) ⇒ `null`, silently. Almost every org has
 *   never configured an ICP; that is the default state, not a misconfiguration.
 * - **Malformed** ⇒ warn and return `null` as a WHOLE — never a salvaged
 *   subset. A partially-recovered definition would be scored against by the
 *   judge and cached per contact under a version the operator never authored,
 *   which is worse than the feature staying off.
 * - **Well-formed** ⇒ returned as stored.
 *
 * `null` here means the same thing everywhere downstream: no column, no tick
 * work, no LLM spend (acceptance criterion 1). Note that a VALID but empty
 * definition also disables the feature — that check is `isIcpConfigured`, which
 * the client shares; this function only answers "is there a parseable one".
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
 * settings read itself fails. A read failure must not 500 the roster or abort a
 * cross-org tick: the feature going quiet for one cycle is recoverable, a
 * failed page is not (same ruling as `resolveDepositRule`).
 *
 * Opens its own transaction via `readCrmSettingsValue` — see the
 * transaction-discipline note at the top of this file: resolve it BEFORE
 * opening the transaction that needs it, never from inside one.
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
 * SQL for the NEXT `icp.version`, computed by Postgres from the row it is
 * updating rather than from a value this process read earlier.
 *
 * This is the whole point of the write below: `version` is what invalidates
 * every cached per-contact score (spec §3.1, §5), so two operators saving
 * concurrently must produce two distinct, strictly increasing versions. A
 * read-modify-write (`select version` → `+1` → `update`) loses one of them and
 * leaves a definition whose version was already scored against — every affected
 * contact then keeps a stale `_icp` forever, because the dirty gate is
 * signature-based and never age-based.
 *
 * Only positive integral numbers whose successor is JavaScript-safe are usable.
 * Everything else (including strings, negative/fractional numbers and huge
 * JSON numerics) restarts numbering at 1. Keeping the range check in `numeric`
 * before the `bigint` cast means a corrupt `1e100` cannot raise 22003 and make
 * the settings row permanently unsaveable.
 */
function nextIcpVersionSql() {
  return sql`(case when jsonb_typeof(${crmSettings.value}->'icp'->'version') = 'number'
      and (${crmSettings.value}->'icp'->>'version')::numeric between 1 and 9007199254740990
      and trunc((${crmSettings.value}->'icp'->>'version')::numeric)
        = (${crmSettings.value}->'icp'->>'version')::numeric
      then ((${crmSettings.value}->'icp'->>'version')::numeric)::bigint
      else 0 end) + 1`;
}

/**
 * Persist an org's ICP definition, bumping `icp.version` ATOMICALLY.
 *
 * The input is parsed with the STRICT write schema — over-cap collections,
 * unknown keys, and a client-supplied `version`/`updatedAt` are rejected rather
 * than clamped or trusted. `updatedAt` is stamped here; `version` comes from
 * {@link nextIcpVersionSql} inside the same statement.
 *
 * Every save bumps the version, even a no-op edit: the version's job is to
 * invalidate cached scores, and a "did anything really change" comparison would
 * have to know which fields the judge is sensitive to. Cheap over-invalidation
 * beats a silently stale score (spec §3.1 — "bump on ANY edit").
 *
 * Only the `icp` key is written (`jsonb_set` on that path); `accounts`,
 * `deposit` and `winAnalysis` on the same row are untouched, so a concurrent
 * writer of another key cannot be clobbered by this one.
 *
 * TODO(handoff): defined and tested here but not yet reachable over HTTP — S6
 * of 2026-08-03-crm-icp-score-spec adds the `/crm/settings` definition editor
 * and its write route (already covered by the central `['/api/crm', 'crm']`
 * entry in `API_WRITE_PREFIXES`, so it needs no new RBAC gate). Until then no
 * org can have an `icp` key, which is exactly the spec's default-off state.
 */
export async function saveIcpDefinition(
  ctx: CoreCtx,
  input: IcpDefinitionInput,
): Promise<IcpDefinition> {
  const parsed = icpDefinitionWriteSchema.parse(input);
  const body = JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() });
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(crmSettings)
      .values({
        orgId: ctx.tenantId,
        // First definition for this org: version 1. The conflict branch below
        // is the one that has a previous version to move forward from.
        value: sql`jsonb_build_object('icp', ${body}::jsonb || jsonb_build_object('version', 1))`,
      })
      .onConflictDoUpdate({
        target: crmSettings.orgId,
        set: {
          // Inside DO UPDATE, a bare column reference reads the EXISTING row
          // (`excluded.*` would be the proposed one) — the same trick
          // `persistWinAnalysis` and `customFieldsMergeSql` rely on, and what
          // makes the version bump a single statement with no pre-image read.
          value: sql`jsonb_set(coalesce(${crmSettings.value}, '{}'::jsonb), '{icp}',
            ${body}::jsonb || jsonb_build_object('version', ${nextIcpVersionSql()}), true)`,
          updatedAt: new Date(),
        },
      })
      .returning({ value: crmSettings.value }),
  );
  const stored = normalizeIcpDefinition((row?.value as { icp?: unknown } | undefined)?.icp);
  if (!stored) {
    // The row we just wrote does not read back as a valid definition — the
    // caller must not be told the save succeeded.
    throw new Error('saveIcpDefinition: stored ICP definition did not round-trip');
  }
  return stored;
}
