/**
 * Deposit-line classification — the one place `crm-finance.service.ts`,
 * `crm-similarity.service.ts` and `crm-journey.service.ts` decide whether an
 * invoice-item description is a booking deposit rather than delivered
 * goods/services. Pure logic, no DB access — mirrors the `crm-scoring.ts`
 * precedent (SQL does the ranking, TS owns the rule).
 *
 * Per-org configuration (S2 of 2026-08-17-hub-reserva-keyword-config-spec):
 * `resolveDepositRule` in `crm-settings.service.ts` reads the org's rule from
 * `crm_settings.value.deposit` and hands it to every function here. This
 * module owns the SHAPE and its normalization; it never touches the DB.
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
 * invoice that is deposits-only. The default is the exact string that call
 * site hardcoded before this rule existed, so an org with no
 * `crm_settings.value.deposit` row keeps byte-identical output. (The spec
 * carried `'Reserva'` as the presumed default from a checkout where hub was
 * not available; S0 recon found the real rendered string — see the
 * "S0 actuals" amendment in FACTORY_SPEC.md.)
 */
export const DEFAULT_DEPOSIT_RULE: DepositRule = {
  keywords: ['reserva'],
  label: 'Reserved a consult',
};

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
// SHAPE and its normalization live here (pure, DB-free); the QUERY that reads
// the row lives in `crm-settings.service.ts` (`resolveDepositRule`).

/** Max characters kept per keyword (and for the label) after trimming. */
export const DEPOSIT_KEYWORD_MAX_LENGTH = 40;
/** Max keywords kept. N keywords multiply the per-row ILIKE cost on an
 *  unindexed `fin_invoice_items.description`, so the list is capped. */
export const DEPOSIT_KEYWORDS_MAX = 20;

/**
 * READ boundary — deliberately LENIENT, and separate from the write schema
 * below. It accepts any type-correct blob (including a legacy row written by
 * hand or by an older, wider cap) and lets `normalizeDepositRule` clamp it,
 * so a settings row that predates today's caps still yields a usable rule
 * instead of 500-ing three analytics surfaces. Only a wrong *shape*
 * (non-array `keywords`, non-string members, a bare string) is malformed.
 * Unknown sibling keys are ignored rather than rejected — the write path is
 * where strictness belongs.
 */
const depositReadSchema = z.object({
  keywords: z.array(z.string()),
  label: z.string().optional(),
  /** ISO, stamped server-side by the write path; read by rebuild tooling. */
  updatedAt: z.string().optional(),
});

/**
 * WRITE boundary — STRICT. Unknown keys are rejected, `updatedAt` is not
 * client-supplyable (the handler stamps it), and over-cap input is REJECTED
 * rather than silently truncated, so an operator who types 21 keywords is
 * told, not quietly given 20.
 *
 * TODO(handoff): defined and unit-tested here but not yet wired to an HTTP
 * handler — S3 of 2026-08-17-hub-reserva-keyword-config-spec adds the
 * `/api/crm/settings` write path (strict parse + key-level jsonb merge +
 * `staleDerived` disclosure) that consumes it.
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

/**
 * Turn a raw `crm_settings.value.deposit` blob into a usable `DepositRule`,
 * or `null` when the blob is malformed (the caller then falls back to
 * `DEFAULT_DEPOSIT_RULE` and logs — see `resolveDepositRule`).
 *
 * Normalization, in order: trim → lowercase → truncate to
 * `DEPOSIT_KEYWORD_MAX_LENGTH` → drop empties → dedupe (first occurrence
 * wins, order preserved) → keep the first `DEPOSIT_KEYWORDS_MAX`.
 * Keywords are lowercased because both match paths are case-insensitive
 * (`ILIKE` / `isDepositText`), so casing carries no meaning and would only
 * defeat the dedupe. The label is display text: trimmed and truncated, never
 * lowercased.
 *
 * An EMPTY keyword list is a legitimate, distinct state ("this org has no
 * deposit concept") — not a reason to fall back to the default. Only the
 * ABSENCE of the `deposit` key means "use the default", and that decision is
 * made by the caller, not here.
 */
export function normalizeDepositRule(raw: unknown): DepositRule | null {
  const parsed = depositReadSchema.safeParse(raw);
  if (!parsed.success) return null;

  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const k of parsed.data.keywords) {
    const norm = k.trim().toLowerCase().slice(0, DEPOSIT_KEYWORD_MAX_LENGTH).trim();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    keywords.push(norm);
    if (keywords.length === DEPOSIT_KEYWORDS_MAX) break;
  }

  const label =
    parsed.data.label?.trim().slice(0, DEPOSIT_KEYWORD_MAX_LENGTH).trim() ||
    DEFAULT_DEPOSIT_RULE.label;

  return { keywords, label };
}
