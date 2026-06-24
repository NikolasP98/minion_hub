/** Pure helpers for CRM Insights (word cloud + sentiment). No I/O, no paraglide. */

/**
 * Spanish/English stopwords + chat noise. The word cloud tokenizes with the
 * `simple` ts config (lowercase, NO stemming) so words render in full ("relleno",
 * not the stem "rellen") — but `simple` keeps stopwords, so we strip them here.
 * Full surface forms (accents kept; `simple` lowercases but preserves accents).
 */
export const EXTRA_STOPWORDS = new Set<string>([
  // chat noise / greetings
  'hola', 'buenas', 'buenos', 'dia', 'dias', 'día', 'días', 'tarde', 'tardes', 'noche', 'noches',
  'gracias', 'ok', 'okay', 'porfa', 'porfavor', 'favor', 'saludos', 'buen', 'hello', 'hi', 'yes',
  'please', 'thanks', 'jaja', 'jajaja', 'jeje',
  // Spanish function words
  'que', 'qué', 'los', 'las', 'del', 'una', 'unos', 'unas', 'por', 'con', 'para', 'como', 'cómo',
  'más', 'mas', 'pero', 'sus', 'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'esos',
  'esas', 'porque', 'cuando', 'cuándo', 'muy', 'sin', 'sobre', 'también', 'hasta', 'hay', 'donde',
  'dónde', 'quien', 'quién', 'desde', 'todo', 'toda', 'todos', 'todas', 'nos', 'durante', 'uno',
  'les', 'contra', 'otros', 'otro', 'otra', 'otras', 'ante', 'ellos', 'ellas', 'ella', 'esto',
  'antes', 'algunos', 'algunas', 'algo', 'nada', 'mucho', 'mucha', 'muchos', 'muchas', 'cual',
  'cuál', 'poco', 'poca', 'estar', 'tengo', 'tiene', 'tienen', 'tener', 'hacer', 'hace', 'puedo',
  'puede', 'pueden', 'quiero', 'quiere', 'mis', 'tus', 'sus', 'una', 'son', 'fue', 'era', 'soy',
  'estoy', 'está', 'están', 'estaba', 'ser', 'haber', 'según', 'entre', 'cada', 'aunque', 'asi',
  'así', 'aqui', 'aquí', 'ahi', 'ahí', 'alli', 'allí', 'ya', 'pues', 'osea', 'okey', 'vale',
  // English function words (mixed-language chats)
  'the', 'and', 'for', 'you', 'are', 'with', 'this', 'that', 'have', 'was', 'but', 'not', 'can',
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
