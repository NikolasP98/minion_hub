/**
 * Deposit-line classification — the one place `crm-finance.service.ts`,
 * `crm-similarity.service.ts` and `crm-journey.service.ts` decide whether an
 * invoice-item description is a booking deposit rather than delivered
 * goods/services. Pure logic, no DB access — mirrors the `crm-scoring.ts`
 * precedent (SQL does the ranking, TS owns the rule).
 *
 * Per-org configuration (S2 of 2026-08-17-hub-reserva-keyword-config-spec):
 * `resolveDepositRule` in `crm-settings.service.ts` reads the org's rule from
 * `crm_settings.value.deposit`, normalizes it there, and hands it to every
 * function here. This module owns the rule SHAPE and the WRITE schema; it
 * never touches the DB.
 */
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export interface DepositRule {
  keywords: string[];
  label: string;
}

/**
 * FACES-era default kept for behavioral compatibility — NOT a universal
 * truth. This is the only occurrence of the word "reserva" in `src/server/`;
 * every call site resolves a `DepositRule` (from `crm_settings.value.deposit`
 * when the org has one, this default otherwise) rather than hardcoding the
 * keyword again.
 *
 * `label` is the milestone caption `crm-journey.service.ts` renders for an
 * invoice that is deposits-only — the only consumer that reads `label` at all
 * (finance/similarity classify but never surface it). The default is the exact
 * string that call site hardcoded before this rule existed, so an org with no
 * `crm_settings.value.deposit` row keeps byte-identical output. (The spec
 * carried `'Reserva'` as the presumed default from a checkout where hub was
 * not available; S0 recon found the real rendered string — see the
 * "S0 actuals" amendment in FACTORY_SPEC.md.) Because this default also backs
 * the omitted-label fallback in `crm-settings.service.ts`'s normalizer, it is
 * what lets journey render `rule.label` directly instead of hardcoding its
 * own string — see 2026-08-20-handoff-minion-hub-2131866440-spec §3.
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

// ── Per-org configuration (S2) ───────────────────────────────────────────────
// `crm_settings.value.deposit` holds the org's own deposit vocabulary. The
// caps below bound BOTH directions and are the single source of truth for
// them: `crm-settings.service.ts` imports them for its READ normalizer
// (`normalizeDepositRule`, which clamps a stored blob) and the strict WRITE
// schema below rejects over-cap input outright. There is deliberately no read
// schema here — reading is lenient by contract and belongs with the query.

/** Max characters kept per keyword (and for the label) after trimming. */
export const DEPOSIT_KEYWORD_MAX_LENGTH = 40;
/** Max keywords kept. N keywords multiply the per-row ILIKE cost on an
 *  unindexed `fin_invoice_items.description`, so the list is capped.
 *  TODO(handoff): Validate the 1-vs-20-keyword production-like EXPLAIN ANALYZE;
 *  the cap remains unproved — see proposals/2026-08-17-hub-reserva-keyword-config.md. */
export const DEPOSIT_KEYWORDS_MAX = 20;

/**
 * WRITE boundary — STRICT. Unknown keys are rejected, `updatedAt` is not
 * client-supplyable (the handler stamps it), and over-cap input is REJECTED
 * rather than silently truncated, so an operator who types 21 keywords is
 * told, not quietly given 20.
 *
 * Consumed by `writeDepositRule` (`crm-settings.service.ts`), wired to
 * `PUT /api/crm/settings` — S3 of 2026-08-17-hub-reserva-keyword-config-spec.
 */
export const depositWriteSchema = z
  .object({
    keywords: z
      .array(z.string().trim().min(1).max(DEPOSIT_KEYWORD_MAX_LENGTH))
      .max(DEPOSIT_KEYWORDS_MAX),
    label: z.string().trim().min(1).max(DEPOSIT_KEYWORD_MAX_LENGTH).optional(),
  })
  .strict();

/** The stored shape of `crm_settings.value.deposit`. */
export type DepositConfig = z.infer<typeof depositWriteSchema> & { updatedAt?: string };
