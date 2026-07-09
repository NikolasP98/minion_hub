import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateText } from 'ai';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { requireAuth } from '$server/auth/authorize';
import { getOpenRouterModel } from '$server/llm';

// Same fast/cheap model tier as notes autocomplete — a spelling lookup is a
// tiny one-shot call and needs low time-to-first-token.
const DEFAULT_MODEL = env.NOTES_AUTOCOMPLETE_MODEL || 'google/gemini-2.5-flash-lite';

/**
 * POST /api/notes/spelling
 * Body: { word: string, sentence?: string, lang?: 'es' | 'en' | 'auto' }
 * → { correct: boolean, suggestions: string[] }
 *
 * Browser spellcheck squiggles are opaque to JS (no suggestions API), so the
 * note editor's context menu asks the model instead. One word per call;
 * clients cache aggressively.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);

	const apiKey = env.OPENROUTER_API_KEY;
	if (!apiKey) throw error(503, 'No AI API key configured');

	const body = (await request.json().catch(() => ({}))) as {
		word?: string;
		sentence?: string;
		lang?: string;
	};
	const word = (body.word ?? '').trim().slice(0, 60);
	if (!word || /\s/.test(word)) throw error(400, 'word must be a single word');
	const sentence = (body.sentence ?? '').slice(0, 300);
	const lang = body.lang === 'es' ? 'Spanish' : body.lang === 'en' ? 'English' : 'the language of the sentence';

	const model = getOpenRouterModel(DEFAULT_MODEL);

	try {
		const { text } = await generateText({
			model,
			maxOutputTokens: 40,
			temperature: 0,
			headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub - Notes Spelling' },
			system:
				`You are a spellchecker for ${lang}. Given a word (and optional sentence for context), ` +
				'reply with EXACTLY "OK" if the word is correctly spelled (including accents). Otherwise ' +
				'reply with up to 3 corrected spellings, comma-separated, nothing else. Preserve the ' +
				"original word's casing style.",
			prompt: sentence ? `Word: ${word}\nSentence: ${sentence}` : `Word: ${word}`
		});
		const raw = text.trim();
		if (/^ok\b/i.test(raw)) return json({ correct: true, suggestions: [] });
		const suggestions = raw
			.split(/[,\n]/)
			.map((s) => s.replace(/^["'\s-]+|["'\s.]+$/g, ''))
			.filter((s) => s.length > 0 && !/\s/.test(s) && s.toLowerCase() !== word.toLowerCase())
			.slice(0, 3);
		return json({ correct: suggestions.length === 0, suggestions });
	} catch (e) {
		console.error('notes/spelling failed', e);
		throw error(502, 'Spelling lookup failed');
	}
};
