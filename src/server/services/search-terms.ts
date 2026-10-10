import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Multi-word, accent-insensitive substring search. Picker/search inputs like
 * "leyla rondon" used to build ONE `%leyla rondon%` ILIKE, which never matches
 * "LEYLA FIORELLA RONDON ESPINAL" (the words aren't adjacent) and never matches
 * "RONDÓN" (accent mismatch). Tokenising on whitespace and ANDing a per-token
 * OR-across-columns LIKE fixes both; folding accents in SQL (not a Postgres
 * extension) keeps it portable to PGlite and prod.
 */

const MAX_TOKENS = 8;

/** Combining diacritical marks left behind by `String.prototype.normalize('NFD')`. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function searchTokens(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase())
    .slice(0, MAX_TOKENS);
}

// Same length by construction (verified by search-terms.test.ts) — translate()
// maps FROM[i] -> TO[i] pairwise. Upper-case accented letters are listed too so
// the fold does not depend on `lower()` knowing the database locale (C locale
// lower-cases ASCII only; the party spine stores names upper-cased).
export const ACCENT_FOLD_FROM = 'áéíóúüñàèìòùâêîôûäëïöçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ';
export const ACCENT_FOLD_TO = 'aeiouunaeiouaeiouaeiocaeiouunaeiouaeiouaeioc';

/** Lowercase + accent-fold a column (or raw sql fragment) for comparison. */
export function foldAccents(col: SQL | AnyColumn): SQL {
  return sql`translate(lower(coalesce(${col}, '')), ${ACCENT_FOLD_FROM}, ${ACCENT_FOLD_TO})`;
}

/** Escape LIKE metacharacters (Postgres' default LIKE escape char is `\`). */
function escapeLikeToken(tok: string): string {
  return tok.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * `AND` across tokens, `OR` across columns within each token — i.e. every
 * token must appear somewhere, in any of the given columns. `undefined` when
 * `q` has no tokens (caller should skip adding a predicate).
 */
export function tokenizedIlike(columns: (SQL | AnyColumn)[], q: string): SQL | undefined {
  const tokens = searchTokens(q);
  if (tokens.length === 0 || columns.length === 0) return undefined;
  const perToken = tokens.map((tok) => {
    const pattern = `%${escapeLikeToken(tok)}%`;
    const perColumn = columns.map((col) => sql`${foldAccents(col)} like ${pattern}`);
    return sql`(${sql.join(perColumn, sql` or `)})`;
  });
  return sql.join(perToken, sql` and `);
}
