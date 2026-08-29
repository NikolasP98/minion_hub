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

/*
 * TODO(handoff): the GATEWAY still hardcodes this default as if it were
 * universal. `minion-ai` `src/agents/tools/knowledge/crm-query-tool.ts:13`
 * (branch `main`, re-verified for this slice) tells the model in its schema
 * hint that "reservation deposits ilike '%reserva%'", so an org that
 * configures `keywords: ['adelanto']` here gets a hub classifying on
 * `adelanto` while the agent is instructed to query `reserva`. Fixing it is
 * deliberately out of scope (different repo, different release train, owned
 * by the approved proposal `2026-08-17-gw-defaces-crm-tools`); that tool's
 * description must be templated from `crm_settings.value.deposit`.
 *
 * The spec's ⚠️ A2 also asks for this paragraph to be appended to that
 * proposal in `minion-meta`. It has NOT been: the implementing harness is
 * scoped to this repository and may not push to, or open a PR against,
 * another one — verified again on 2026-08-29, the proposal's `## Open items`
 * section on meta `dev` still has no `crm-query-tool` entry. The exact
 * sentence to append is in
 * `specs/2026-08-17-hub-reserva-keyword-config-s0-actuals.md` (⚠️ A2
 * section), which is where a human or a meta-scoped run picks it up.
 */

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
 *
 *  MEASURED, not guessed (S3's perf ship gate). `explain analyze` of the
 *  finance classification query at 1/4/5/20 keywords, on a real PostgreSQL
 *  engine over 120k and 360k invoice-item rows, cost 1.00× / 1.90× / 2.09× /
 *  6.47× the one-keyword query — the curve is linear in keyword count and
 *  scale-invariant. The spec's rule is "lower the cap if 20 regresses beyond
 *  ~2×", and 20 regresses ~6.5×, so the cap is the largest size that stays at
 *  the ~2× bound: FIVE, which still holds a full deposit vocabulary
 *  (`reserva`, `adelanto`, `seña`, `anticipo`, `abono`). Reproduce with
 *  `bun run scripts/deposit-keyword-perf.ts`; the numbers and the method's
 *  limits are recorded in
 *  `specs/2026-08-17-hub-reserva-keyword-config-s0-actuals.md`.
 *
 *  Raising it again is an INDEX question, not a config question: give
 *  `description` a trigram index (`pg_trgm`) — a schema change this spec puts
 *  out of scope — and re-measure. */
export const DEPOSIT_KEYWORDS_MAX = 5;

/**
 * WRITE boundary — STRICT. Unknown keys are rejected, `updatedAt` is not
 * client-supplyable (the handler stamps it), and over-cap input is REJECTED
 * rather than silently truncated, so an operator who types one keyword too
 * many is told, not quietly given `DEPOSIT_KEYWORDS_MAX` of them.
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
