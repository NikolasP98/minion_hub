// Shared transcription preferences (auto-polish + intent), persisted to
// localStorage so every TranscribeButton instance and the note editor's commit
// logic read the same settings.

export type TxIntent = 'auto' | 'meeting' | 'monologue' | 'dictation' | 'notes';

export const TX_INTENTS: { id: TxIntent; label: string; hint: string }[] = [
	{ id: 'auto', label: 'Auto', hint: 'Let the model decide' },
	{ id: 'meeting', label: 'Meeting', hint: 'Multiple speakers, decisions & actions' },
	{ id: 'monologue', label: 'Stream of thought', hint: 'One speaker thinking aloud' },
	{ id: 'dictation', label: 'Dictation', hint: 'Verbatim, light cleanup only' },
	{ id: 'notes', label: 'Notes', hint: 'Condense into note-style bullets' }
];

/** Note-editor language — drives spellcheck (`lang` attr) + speech recognition. */
export type NoteLang = 'auto' | 'es' | 'en';
export const NOTE_LANGS: NoteLang[] = ['auto', 'es', 'en'];

const KEY = 'minion-transcription-prefs';

export const txPrefs = $state<{ autoPolish: boolean; intent: TxIntent; lang: NoteLang }>({
	autoPolish: false,
	intent: 'auto',
	lang: 'auto'
});

// One-time load (client only — guarded for SSR).
if (typeof localStorage !== 'undefined') {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const v = JSON.parse(raw) as Partial<typeof txPrefs>;
			if (typeof v.autoPolish === 'boolean') txPrefs.autoPolish = v.autoPolish;
			if (v.intent && TX_INTENTS.some((i) => i.id === v.intent)) txPrefs.intent = v.intent;
			if (v.lang && NOTE_LANGS.includes(v.lang)) txPrefs.lang = v.lang;
		}
	} catch {
		/* ignore corrupt prefs */
	}
}

export function saveTxPrefs(): void {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ autoPolish: txPrefs.autoPolish, intent: txPrefs.intent, lang: txPrefs.lang })
		);
	} catch {
		/* storage unavailable */
	}
}

export function setAutoPolish(on: boolean): void {
	txPrefs.autoPolish = on;
	saveTxPrefs();
}

export function setIntent(intent: TxIntent): void {
	txPrefs.intent = intent;
	saveTxPrefs();
}

export function setNoteLang(lang: NoteLang): void {
	txPrefs.lang = lang;
	saveTxPrefs();
}

/** BCP-47 tag for the Web Speech API ('' = follow the browser). */
export function speechLang(): string {
	if (txPrefs.lang === 'es') return 'es-ES';
	if (txPrefs.lang === 'en') return 'en-US';
	return '';
}
