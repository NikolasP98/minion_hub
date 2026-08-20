/**
 * Deposit-line classification — the one place `crm-finance.service.ts`,
 * `crm-similarity.service.ts` and `crm-journey.service.ts` decide whether an
 * invoice-item description is a booking deposit rather than delivered
 * goods/services. Pure logic, no DB access — mirrors the `crm-scoring.ts`
 * precedent (SQL does the ranking, TS owns the rule).
 *
 * S2 (2026-08-17-hub-reserva-keyword-config-spec) adds `resolveDepositRule`
 * in the CRM settings layer, reading a per-org `DepositRule` from
 * `crm_settings.value.deposit`; this module stays DB-free.
 */
import { sql, type SQL } from 'drizzle-orm';

export interface DepositRule {
  keywords: string[];
  label: string;
}

/**
 * FACES-era default kept for behavioral compatibility — NOT a universal
 * truth. This is the only occurrence of the word "reserva" in `src/server/`;
 * every call site resolves a `DepositRule` (this default until S2 wires
 * `crm_settings.value.deposit`) rather than hardcoding the keyword again.
 *
 * `label` is `'Reserved a consult'`, not `'Reserva'`: `crm-journey.service.ts`
 * is the only consumer that reads `label` (finance/similarity classify but
 * never surface it), and its shipped absent-config copy has always been
 * `'Reserved a consult'`. Since this default also backs the normalized
 * omitted-label fallback in `crm-settings.service.ts`, changing it here is
 * what lets journey use `rule.label` directly instead of hardcoding its own
 * string — see 2026-08-20-handoff-minion-hub-2131866440-spec §3.
 */
export const DEFAULT_DEPOSIT_RULE: DepositRule = {
  keywords: ['reserva'],
  label: 'Reserved a consult',
};

/**
 * Stable fingerprint of a rule's MATCHING semantics — folded into the `d`
 * descriptor of every cache key whose payload carries deposit classification
 * (the finance map, the ranked roster). A same-tenant rule change then lands on
 * a DIFFERENT key, so the next call can never be served a result classified
 * under the previous rule, TTL/SWR notwithstanding.
 *
 * Only `keywords` participate: `label` is display-only and never reaches SQL.
 * `null` = the caller resolved no rule at all (finances off ⇒ no classification
 * in the payload), which is its own cache identity. Textual JSON on purpose —
 * a raw delimiter byte in a source file makes Git treat it as binary.
 */
export function depositRuleFingerprint(rule: DepositRule | null): string {
  return rule ? JSON.stringify(rule.keywords) : 'none';
}

/**
 * Escapes ILIKE/LIKE wildcards (`\`, `%`, `_`) in an operator-supplied
 * keyword and wraps it in `%…%`. Every pattern builder in this module goes
 * through this function; never build an ILIKE pattern by interpolation
 * anywhere else — an unescaped `%` or `_` turns a keyword into a wildcard
 * instead of a literal (e.g. a keyword of `100%` would match every row).
 */
export function escapeLikePattern(keyword: string): string {
  const escaped = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

function patterns(rule: DepositRule): string[] {
  return rule.keywords.map(escapeLikePattern);
}

/**
 * SQL predicate: `column` matches ANY of the rule's keywords (i.e. this line
 * IS a deposit). `column` is a trusted, hardcoded column reference (e.g.
 * `'ii.description'`) — never pass user input here, only keywords are
 * operator-supplied and those are always bound as query parameters.
 *
 * Total boolean: coalesced to `false` for a `NULL` column, matching
 * `isDepositText(null, rule) === false` — bare `ILIKE` returns SQL `NULL` for
 * a `NULL` column, which is neither true nor false and would let the SQL and
 * TS twins disagree for any caller that doesn't separately guard `is not
 * null` (the shared 10-case table in `crm-deposit-rule.fixtures.ts` asserts
 * this against real PostgreSQL).
 *
 * Empty keywords ⇒ `sql\`false\`` — never `undefined`. A dropped predicate in
 * an `and(...)`/`or(...)` chain would silently widen the result set, which is
 * the failure mode this module exists to prevent.
 */
/**
 * `depositMatchSql` as an ORDER BY key: procedures (0) before deposits (1).
 *
 * PostgreSQL rejects a bare constant as a sort key ("non-integer constant in
 * ORDER BY" — a bare constant there is reserved for ordinal column references),
 * so `order by ${depositMatchSql(...)}` is a runtime 42601 for a ZERO-keyword
 * rule, where the predicate compiles to the literal `false`. Every call site
 * that sorts by deposit-ness must go through this CASE instead of interpolating
 * the boolean predicate directly.
 */
export function depositSortKeySql(column: string, rule: DepositRule): SQL {
  return sql`(case when ${depositMatchSql(column, rule)} then 1 else 0 end)`;
}

export function depositMatchSql(column: string, rule: DepositRule): SQL {
  const pats = patterns(rule);
  if (pats.length === 0) return sql`false`;
  const col = sql.raw(column);
  const disjunction = sql.join(
    pats.map((p) => sql`${col} ilike ${p}`),
    sql` or `,
  );
  return sql`coalesce((${disjunction}), false)`;
}

/**
 * SQL predicate: `column` matches NONE of the rule's keywords (i.e. this line
 * is NOT a deposit). Two named exports, one per polarity — call sites pick a
 * name and never wrap the other one in an ad-hoc `not()`, so a flipped
 * polarity is a review-visible word rather than a punctuation change.
 *
 * Total boolean: coalesced to `true` for a `NULL` column, matching
 * `!isDepositText(null, rule) === true` — see `depositMatchSql` for why a
 * bare `NOT ILIKE` (SQL `NULL`) would silently diverge from the TS twin.
 *
 * Empty keywords ⇒ `sql\`true\`` — never `undefined`, mirroring
 * `depositMatchSql`.
 */
export function notDepositMatchSql(column: string, rule: DepositRule): SQL {
  const pats = patterns(rule);
  if (pats.length === 0) return sql`true`;
  const col = sql.raw(column);
  const conjunction = sql.join(
    pats.map((p) => sql`${col} not ilike ${p}`),
    sql` and `,
  );
  return sql`coalesce((${conjunction}), true)`;
}

/**
 * TS-side twin of `depositMatchSql`, for sites that classify rows already in
 * memory. Same casefold semantics as ILIKE: lowercase both sides, substring
 * match, `null`/`undefined` ⇒ `false` (the same total-boolean contract as the
 * coalesced SQL predicates above) — asserted against
 * `depositMatchSql`/`notDepositMatchSql` on a shared test table so the SQL
 * and TS answers can never diverge.
 */
export function isDepositText(text: string | null | undefined, rule: DepositRule): boolean {
  if (text == null) return false;
  const lower = text.toLowerCase();
  return rule.keywords.some((k) => lower.includes(k.toLowerCase()));
}
