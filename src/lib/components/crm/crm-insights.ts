/** Pure helpers for CRM Insights (word cloud + sentiment). No I/O, no paraglide. */

/**
 * Common Spanish/English chat noise that `ts_stat('spanish')` does not strip.
 * NOTE: ts_stat returns STEMMED tokens, so the denylist holds stems too
 * (e.g. "hola"→"hol", "hacer"→"hac", "día"→"dia").
 */
export const EXTRA_STOPWORDS = new Set<string>([
  'hola', 'hol', 'buenas', 'buenos', 'dias', 'dia', 'tardes', 'noches', 'gracias', 'ok', 'okay',
  'si', 'no', 'porfa', 'porfavor', 'favor', 'saludos', 'hac', 'hello', 'hi', 'yes', 'please', 'thanks',
]);
export function isStopword(word: string): boolean {
  return EXTRA_STOPWORDS.has(word.trim().toLowerCase());
}

/** Keep only real words: drops slash-commands (/new, /end), numbers, and punctuation tokens. */
export function isWordlike(word: string): boolean {
  return /^\p{L}+$/u.test(word);
}

/** UTC year-month key, e.g. '2026-06'. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Map a [-1,1] sentiment score to a label. */
export function scoreToLabel(score: number): 'positive' | 'neutral' | 'negative' {
  if (score >= 0.25) return 'positive';
  if (score <= -0.25) return 'negative';
  return 'neutral';
}

/** Sqrt-scale a frequency count into a font-size px range (clamped). */
export function wordSize(count: number, min: number, max: number, range: [number, number] = [12, 48]): number {
  const [lo, hi] = range;
  if (max <= min) return lo;
  const t = Math.sqrt((count - min) / (max - min));
  return Math.round(lo + t * (hi - lo));
}
