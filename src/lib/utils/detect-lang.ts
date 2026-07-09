// Tiny stopword-based ES/EN language detection for note text. Used for the
// zen-mode meta display and to pick the editor's `lang` attribute when the
// language preference is "auto". Deliberately heuristic — two languages, no
// dependency. ponytail: add franc/tinyld only if more languages are needed.

export type DetectedLang = 'es' | 'en' | null;

const ES = new Set([
	'de', 'la', 'el', 'en', 'los', 'las', 'que', 'y', 'un', 'una', 'para', 'por',
	'con', 'del', 'se', 'es', 'al', 'como', 'más', 'esto', 'esta', 'este', 'su',
	'sus', 'pero', 'sobre', 'entre', 'también', 'porque', 'cuando', 'hay', 'ser',
	'son', 'está', 'tiene', 'muy', 'qué', 'cuáles', 'antes', 'todo', 'todos'
]);
const EN = new Set([
	'the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'it', 'on', 'with', 'as',
	'are', 'this', 'be', 'was', 'at', 'by', 'an', 'or', 'from', 'not', 'but',
	'have', 'has', 'they', 'you', 'we', 'his', 'her', 'its', 'their', 'which',
	'will', 'can', 'all', 'when', 'what', 'about'
]);

export function detectLang(text: string): DetectedLang {
	let es = 0;
	let en = 0;
	for (const w of text.toLowerCase().split(/[^a-záéíóúüñ'’]+/i)) {
		if (ES.has(w)) es++;
		else if (EN.has(w)) en++;
	}
	if (es < 3 && en < 3) return null; // too little signal
	if (es > en * 1.2) return 'es';
	if (en > es * 1.2) return 'en';
	return null;
}

/** Words = tokens containing at least one letter (skips list markers, numbers). */
export function countWords(text: string): number {
	return text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
