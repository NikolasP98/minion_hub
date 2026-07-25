/**
 * Catalog code format — the ONE rail for fin_products.code and stk_items.code.
 *
 * Format: 2–4 characters, uppercase A–Z and 0–9 only.
 *
 * Why no separators: the live catalog contained `CMSVP` AND `CM-SVP` — the same
 * product twice, and the hyphen was the only difference. Same for `RSSVP`/
 * `RS-SVP` and `RO`/`RO-I`. Allowing an optional separator makes every code
 * silently ambiguous and duplicate-prone, so the character class excludes it.
 * Spaces were worse (`OO1 990`, `FACES 4788`) and are likewise out.
 *
 * Why 4 max: the codes are read off a screen and typed at a POS terminal.
 *
 * ⚠️ `code` is NOT a label — it is a live business key. `loadProductMap()` keys
 * the SUSII invoice-sync on it, so CHANGING an existing product's code detaches
 * that product from its billing history on the next sync. This module validates
 * format only; it does not make a rename safe. See the alias path in
 * `docs/catalog-cleanup` before recoding anything that already has invoices.
 *
 * Shared by the client wizard and the server service deliberately: the previous
 * arrangement had `slugifyCode` in pos.service.ts and a hand-copied `slugify`
 * in SellableWizard.svelte ("mirrored client-side"), and they had already
 * drifted apart in their length and separator handling.
 */

export const CODE_MIN = 2;
export const CODE_MAX = 4;

/** Anchored, for `new RegExp` reuse and the HTML `pattern` attribute alike. */
export const CODE_PATTERN = `[A-Z0-9]{${CODE_MIN},${CODE_MAX}}`;
const CODE_RE = new RegExp(`^${CODE_PATTERN}$`);

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

export type CodeError = 'empty' | 'too_short' | 'too_long' | 'charset';

/** null = valid. Callers map the reason to a localized message. */
export function codeError(raw: string): CodeError | null {
  const code = raw.trim();
  if (code === '') return 'empty';
  if (!/^[A-Za-z0-9]+$/.test(code)) return 'charset';
  if (code.length < CODE_MIN) return 'too_short';
  if (code.length > CODE_MAX) return 'too_long';
  return isValidCode(code.toUpperCase()) ? null : 'charset';
}

/**
 * Best-effort normalization of anything a human typed or pasted: uppercase,
 * strip every non-alphanumeric character, truncate to CODE_MAX. Used as the
 * input's live filter, so a paste of "CM-SVP" becomes "CMSV" in front of the
 * user rather than being silently rejected on submit.
 *
 * Note this can still return a too-short result (""/"X") — normalization is not
 * validation. Always gate submit on `codeError`.
 */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_MAX);
}

/**
 * Suggest a code from a product name, for the create wizard only.
 *
 * Strategy: initials of the first words, which is how the existing catalog was
 * (inconsistently) built — "Malar Saypha Volume Plus" → "MSVP". Falls back to
 * the first CODE_MAX alphanumerics of a single-word name ("Eudaria" → "EUDA").
 * Uniqueness is NOT guaranteed; the caller owns collision handling (the server
 * already surfaces a `code_taken` error, and `uniqueCodeFrom` below resolves it).
 */
export function suggestCode(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, CODE_MAX);
  const initials = words.map((w) => w[0]).join('');
  return initials.slice(0, CODE_MAX);
}

/**
 * `suggestCode` plus collision resolution against codes already in use: the
 * last character is replaced by 2..9, then a two-digit tail is tried, so the
 * result always stays within CODE_MAX. Returns '' when `name` yields nothing.
 *
 * ponytail: linear probe over a Set — the catalog is ~100 rows, not 100k. If a
 * tenant ever grows past a few thousand codes, index by prefix instead.
 */
export function uniqueCodeFrom(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()));
  const base = suggestCode(name);
  if (base === '') return '';
  if (base.length >= CODE_MIN && !used.has(base)) return base;

  // Pad a 1-char base up to the minimum before probing ("A" → "A2").
  const stem = base.length < CODE_MIN ? base : base.slice(0, CODE_MAX - 1);
  for (let n = 2; n <= 9; n++) {
    const candidate = `${stem}${n}`;
    if (candidate.length >= CODE_MIN && !used.has(candidate)) return candidate;
  }
  const stem2 = base.slice(0, Math.max(1, CODE_MAX - 2));
  for (let n = 10; n <= 99; n++) {
    const candidate = `${stem2}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return '';
}
