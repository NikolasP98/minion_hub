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
  | 'empty' // blank/missing name
  | 'emoji' // emoji / pictographs stripped from the name
  | 'wrapped' // wrapped in brackets/quotes — "(Joan Rojas)" → "Joan Rojas"
  | 'spacing' // run-together name; spaces inferred ("MelissaBastosM" → "Melissa Bastos M")
  | 'symbols'; // leetspeak / foreign glyphs / digits → needs AI parsing ("Miigu£l", "Ęţşøņ")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emoji, pictographs, skin-tone modifiers, ZWJ, variation selectors, keycaps.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{200D}️⃣]/gu;
// Spanish-clean name: Latin letters + Spanish accents + name punctuation only.
// Anything else (digits, £, foreign diacritics ęţşøņ, ª) means it needs AI parsing.
const ALLOWED_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'’.\-]+$/;

/** Per-issue confidence the proposal is right (1 = certain). Group min = row confidence. */
const ISSUE_CONF: Record<NameIssue, number> = {
  whitespace: 0.95,
  emoji: 0.9,
  wrapped: 0.9,
  casing: 0.9,
  lowercase: 0.9,
  uppercase: 0.9,
  spacing: 0.75,
  symbols: 0.5,
  email_as_name: 0.5,
  too_long: 0.25,
  empty: 0.15,
};

/** Strip emoji/pictographs and collapse the whitespace they leave behind. */
export function stripEmoji(s: string): string {
  return normalizeWhitespace(s.replace(EMOJI_RE, ' '));
}

/** Unwrap a name fully enclosed in brackets/quotes: "(Joan Rojas)" → "Joan Rojas". */
function stripWrapping(s: string): string {
  const m = s.trim().match(/^[([{<«"“'‘]+\s*(.*?)\s*[)\]}>»"”'’]+$/u);
  return m && m[1].trim() ? m[1].trim() : s.trim();
}

// ponytail: camelCase split + acronym preserve. Handles mixed-case run-togethers
// ("MelissaBastosM" → "Melissa Bastos M", "PattyQR" → "Patty QR"); a pure-lowercase
// blob ("fresiamurguiavilchez") can't be split safely and is flagged for AI instead.
function splitCamel(s: string): string {
  const split = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  if (split === s) return s;
  return split
    .split(' ')
    .map((t) => (/^[A-ZÁÉÍÓÚÜÑ]{1,3}$/.test(t) ? t : capWord(t)))
    .join(' ');
}

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
  /** 0..1, higher = more certain the proposal is right. Used to sort the cleanup list. */
  confidence: number;
}

/** Build a proposal with a confidence derived from its issues (min, halved if it needs review). */
function result(proposed: string | null, issues: NameIssue[], needsReview: boolean): NameProposal {
  const conf = issues.length ? Math.min(...issues.map((i) => ISSUE_CONF[i] ?? 0.5)) : 0.85;
  return { proposed, issues, needsReview, confidence: needsReview ? Math.min(conf, 0.45) : conf };
}

/**
 * Propose a standardized name. Returns the cleaned value, the detected issues,
 * and whether it needs review. `proposed === current` (and no issues) means the
 * name is already clean.
 */
export function proposeName(currentRaw: string | null | undefined): NameProposal {
  const current = (currentRaw ?? '').toString();
  const issues: NameIssue[] = [];

  // 1. Strip emoji/pictographs, then unwrap brackets/quotes — both deterministic.
  const deEmoji = stripEmoji(current);
  if (deEmoji !== normalizeWhitespace(current)) issues.push('emoji');
  const unwrapped = stripWrapping(deEmoji);
  if (unwrapped !== deEmoji.trim()) issues.push('wrapped');
  let trimmed = normalizeWhitespace(unwrapped);

  if (trimmed.length === 0) {
    return result(null, [...issues, 'empty'], true);
  }

  if (isEmailAsName(trimmed)) {
    // Derive a candidate display name from the email local-part, but flag for
    // review — the rules can't know the person's real name.
    const local = trimmed.split('@')[0].replace(/[._-]+/g, ' ');
    return result(titleCaseName(local), [...issues, 'email_as_name'], true);
  }

  if (trimmed.length > 80) {
    // Almost certainly not a name (pasted text / disclaimer).
    return result(trimmed.slice(0, 80), [...issues, 'too_long'], true);
  }

  // 2. Leetspeak / foreign glyphs / stray digits → strip vanity decoration to a clean
  //    letters-only baseline and flag for AI (which may re-insert a letter where a glyph
  //    stood in: "Miigu£l"→"Miguel", "Ęţşøņ"→"Etson"). Pure-vanity ("~~gabi~~"→"gabi",
  //    "Shioko<3"→"Shioko") is just removed. Always trimmed.
  if (!ALLOWED_RE.test(trimmed)) {
    const cleaned = normalizeWhitespace(trimmed.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'.\-]+/g, ' '));
    return result(cleaned ? titleCaseName(cleaned) : null, [...issues, 'symbols'], true);
  }

  if (current !== normalizeWhitespace(current)) issues.push('whitespace');

  // 3. Run-together single token → infer word boundaries.
  if (!/\s/.test(trimmed)) {
    const split = splitCamel(trimmed);
    if (split !== trimmed) {
      // Deterministic camelCase split — keep its (meaningful) casing, no review.
      return result(split, [...issues, 'spacing'], false);
    }
    if (trimmed.length >= 12 && trimmed === trimmed.toLocaleLowerCase()) {
      // A lowercase blob ("fresiamurguiavilchez") can't be split safely → AI/manual.
      return result(titleCaseName(trimmed), [...issues, 'spacing'], true);
    }
  }

  if (trimmed === trimmed.toLocaleLowerCase() && /\p{Ll}/u.test(trimmed)) issues.push('lowercase');
  if (trimmed === trimmed.toLocaleUpperCase() && /\p{Lu}/u.test(trimmed)) issues.push('uppercase');

  const titled = titleCaseName(trimmed);
  if (titled !== trimmed && !issues.includes('lowercase') && !issues.includes('uppercase')) {
    issues.push('casing');
  }

  // Clear, mechanical fixes don't need review; only anomalies do.
  return result(titled, issues, false);
}

/**
 * True when a name has ≤1 alphanumeric character — blank, whitespace, punctuation-only
 * (".", "~"), a single letter ("J"), or emoji-only. These can't be auto-fixed and are
 * routed to the manual "Needs a name" section instead of the standardization scan.
 */
export function isUnnamed(s: string | null | undefined): boolean {
  return (s ?? '').replace(/[^\p{L}\p{N}]/gu, '').length <= 1;
}

/** A normalized key for duplicate detection (accents stripped, lowercased). */
export function nameKey(s: string | null | undefined): string {
  return normalizeWhitespace((s ?? '').toString())
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics
}
