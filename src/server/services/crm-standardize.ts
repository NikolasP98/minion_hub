/**
 * Deterministic contact-name standardization (spec: Data Hygiene).
 *
 * Stage 1 of the cleanup pipeline: pure, rule-based proposals (Spanish-aware
 * title-case, email-as-name detection, whitespace/sanitisation). An LLM agent
 * reviews these proposals in stage 2 — but the rules handle the clear majority
 * (e.g. "vale gonz" → "Vale Gonz") with no token cost. Pure + unit-testable.
 */

/** Spanish name particles that stay lowercase mid-name (not as the first word). */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos']);

export type NameIssue =
  | 'email_as_name' // the name is an email address
  | 'lowercase' // all-lowercase, needs casing
  | 'uppercase' // ALL CAPS
  | 'whitespace' // leading/trailing/double spaces
  | 'casing' // mixed/odd casing that title-case changes
  | 'too_long' // suspiciously long (likely junk, e.g. a pasted paragraph)
  | 'empty'; // blank/missing name

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Collapse runs of whitespace and trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** True if the string is (essentially) just an email address. */
export function isEmailAsName(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Capitalize one token: first letter upper, rest lower (Unicode-aware). */
function capWord(w: string): string {
  if (!w) return w;
  // Keep hyphenated/apostrophe sub-parts capitalized ("ana-maria" → "Ana-Maria").
  return w
    .split(/([-'’])/)
    .map((part) => (/[-'’]/.test(part) ? part : part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase()))
    .join('');
}

/**
 * Spanish-aware title-case: capitalize each word, but keep particles
 * (de, la, del, …) lowercase except when they are the first word.
 */
export function titleCaseName(s: string): string {
  const words = normalizeWhitespace(s).split(' ');
  return words
    .map((w, i) => {
      const lower = w.toLocaleLowerCase();
      if (i > 0 && PARTICLES.has(lower)) return lower;
      return capWord(w);
    })
    .join(' ');
}

export interface NameProposal {
  /** Cleaned/standardized name, or null if it should be cleared (e.g. email). */
  proposed: string | null;
  issues: NameIssue[];
  /** True when a human/agent should look before applying (ambiguous/anomalous). */
  needsReview: boolean;
}

/**
 * Propose a standardized name. Returns the cleaned value, the detected issues,
 * and whether it needs review. `proposed === current` (and no issues) means the
 * name is already clean.
 */
export function proposeName(currentRaw: string | null | undefined): NameProposal {
  const current = (currentRaw ?? '').toString();
  const trimmed = normalizeWhitespace(current);
  const issues: NameIssue[] = [];

  if (trimmed.length === 0) {
    return { proposed: null, issues: ['empty'], needsReview: true };
  }

  if (isEmailAsName(trimmed)) {
    // Derive a candidate display name from the email local-part, but flag for
    // review — the rules can't know the person's real name.
    const local = trimmed.split('@')[0].replace(/[._-]+/g, ' ');
    const guess = titleCaseName(local);
    return { proposed: guess, issues: ['email_as_name'], needsReview: true };
  }

  if (trimmed.length > 80) {
    // Almost certainly not a name (pasted text / disclaimer).
    return { proposed: trimmed.slice(0, 80), issues: ['too_long'], needsReview: true };
  }

  if (current !== trimmed) issues.push('whitespace');
  if (trimmed === trimmed.toLocaleLowerCase() && /[a-z]/.test(trimmed)) issues.push('lowercase');
  if (trimmed === trimmed.toLocaleUpperCase() && /[A-Z]/.test(trimmed)) issues.push('uppercase');

  const titled = titleCaseName(trimmed);
  if (titled !== trimmed && !issues.includes('lowercase') && !issues.includes('uppercase')) {
    issues.push('casing');
  }

  return {
    proposed: titled,
    issues,
    // Clear, mechanical fixes don't need review; only anomalies do.
    needsReview: false,
  };
}

/** A normalized key for duplicate detection (accents stripped, lowercased). */
export function nameKey(s: string | null | undefined): string {
  return normalizeWhitespace((s ?? '').toString())
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics
}
