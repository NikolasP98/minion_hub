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
 */
export const DEFAULT_DEPOSIT_RULE: DepositRule = { keywords: ['reserva'], label: 'Reserva' };

/**
 * The reserve-milestone label crm-journey.service.ts has always shown for an
 * absent/malformed deposit config — NOT `DEFAULT_DEPOSIT_RULE.label`
 * ('Reserva', a display value nothing before this read). Journey is the only
 * caller that consumes `DepositRule.label`; finance and similarity only use
 * the keywords. `normalizeDepositRule` resolves an omitted/malformed label to
 * this text so the byte-identical absent-config invariant holds.
 */
export const DEFAULT_RESERVE_LABEL = 'Reserved a consult';

/** Result of validating a raw `crm_settings.value.deposit` JSON blob. */
export interface NormalizedDepositRule {
  rule: DepositRule;
  /** False when `raw` was present but not a valid `{ keywords: string[], label?:
   *  string }` shape — the caller decides whether/how to surface a warning. */
  ok: boolean;
}

/**
 * Bounds on a stored rule. Every keyword is expanded into at least two ILIKE
 * bind parameters per finance/journey query (`depositMatchSql` +
 * `notDepositMatchSql`), so an unbounded array is a live path to exceeding
 * PostgreSQL's 65,535 bind-parameter ceiling and turning every journey/finance
 * read for that org into a 500. `MAX_DEPOSIT_KEYWORD_LENGTH`/
 * `MAX_DEPOSIT_LABEL_LENGTH` bound the operator-editable strings themselves.
 */
export const MAX_DEPOSIT_KEYWORDS = 100;
export const MAX_DEPOSIT_KEYWORD_LENGTH = 200;
export const MAX_DEPOSIT_LABEL_LENGTH = 200;

/**
 * Pure, DB-free normalization of a raw `crm_settings.value.deposit` value
 * into a usable `DepositRule`. `raw === undefined` (key absent) and a valid
 * `{ keywords: [] }` (explicitly no keywords) are both NOT malformed — they
 * fall through to `ok: true` with, respectively, the default keywords and an
 * empty list. Anything else that isn't `{ keywords: string[], label?: string
 * }` is malformed and resolves to the same default rule, `ok: false` —
 * including a keyword array over `MAX_DEPOSIT_KEYWORDS`, any keyword or
 * `label` over its length cap, and a present `label` that isn't a string. A
 * blank/whitespace-only `label` is not malformed (mirrors the empty-keywords
 * case) — it falls back to `DEFAULT_RESERVE_LABEL` with `ok: true`.
 */
export function normalizeDepositRule(raw: unknown): NormalizedDepositRule {
  const fallback: DepositRule = {
    keywords: [...DEFAULT_DEPOSIT_RULE.keywords],
    label: DEFAULT_RESERVE_LABEL,
  };
  if (raw === undefined) return { rule: fallback, ok: true };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { rule: fallback, ok: false };
  }
  const o = raw as Record<string, unknown>;
  const keywordsValid =
    Array.isArray(o.keywords) &&
    o.keywords.length <= MAX_DEPOSIT_KEYWORDS &&
    o.keywords.every((k) => typeof k === 'string' && k.length <= MAX_DEPOSIT_KEYWORD_LENGTH);
  if (!keywordsValid) return { rule: fallback, ok: false };
  if (o.label !== undefined && typeof o.label !== 'string') {
    return { rule: fallback, ok: false };
  }
  if (typeof o.label === 'string' && o.label.length > MAX_DEPOSIT_LABEL_LENGTH) {
    return { rule: fallback, ok: false };
  }
  const keywords = (o.keywords as string[]).map((k) => k.trim()).filter((k) => k.length > 0);
  const label =
    typeof o.label === 'string' && o.label.trim().length > 0
      ? o.label.trim()
      : DEFAULT_RESERVE_LABEL;
  return { rule: { keywords, label }, ok: true };
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
 * Empty keywords ⇒ `sql\`coalesce(false, false)\`` — never `undefined`, and
 * never a bare `false` literal: PostgreSQL's SQL92 ORDER BY rule rejects an
 * unparenthesized/unwrapped boolean constant there ("non-integer constant in
 * ORDER BY") — both `depositMatchSql`/`notDepositMatchSql` are used in an
 * `ORDER BY` position (representative-item ordering), not just `WHERE`, so
 * the literal must be wrapped in an expression to stay valid in either. A
 * dropped predicate in an `and(...)`/`or(...)` chain would also silently
 * widen the result set, which is the failure mode this module exists to
 * prevent.
 */
export function depositMatchSql(column: string, rule: DepositRule): SQL {
  const pats = patterns(rule);
  if (pats.length === 0) return sql`coalesce(false, false)`;
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
 * Empty keywords ⇒ `sql\`coalesce(true, true)\`` — never `undefined`,
 * mirroring `depositMatchSql` (see its ORDER BY note for why a bare literal
 * isn't safe here either).
 */
export function notDepositMatchSql(column: string, rule: DepositRule): SQL {
  const pats = patterns(rule);
  if (pats.length === 0) return sql`coalesce(true, true)`;
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
