import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateText } from 'ai';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { requireAuth } from '$server/auth/authorize';
import { getOpenRouterModel } from '$server/llm';

// Cheap, fast model — polishing is a light-touch rewrite, not creative writing.
const DEFAULT_MODEL = env.NOTES_POLISH_MODEL || env.NOTES_AUTOCOMPLETE_MODEL || 'google/gemini-2.5-flash';
const MAX_INPUT = 6000;

// Per-intent flavour appended to the base polish instruction.
const INTENT_HINTS: Record<string, string> = {
  meeting:
    ' This is a meeting transcript: keep speaker turns readable and preserve decisions and action items.',
  monologue: ' This is one person thinking aloud: keep their voice, just make it readable.',
  dictation: ' This is dictation: stay verbatim — only fix punctuation/casing/obvious slips.',
  notes: ' Condense lightly into clear note-style prose; keep all facts.',
};

/**
 * POST /api/notes/polish
 * Body: { text: string, intent?: string }  →  { text: string }
 *
 * Cleans up raw dictated/transcribed text: fixes punctuation, capitalization and
 * obvious speech-to-text slips WITHOUT changing meaning, adding content, or
 * answering anything. `intent` lightly biases the cleanup (meeting/dictation/…).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const body = (await request.json().catch(() => ({}))) as { text?: string; intent?: string };
  const input = (body.text ?? '').slice(0, MAX_INPUT).trim();
  if (!input) return json({ text: '' });
  const intentHint = body.intent ? (INTENT_HINTS[body.intent] ?? '') : '';

  const model = getOpenRouterModel(DEFAULT_MODEL);

  const { text } = await generateText({
    model,
    maxOutputTokens: 800,
    temperature: 0.2,
    headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub - Notes Polish' },
    system:
      'You polish raw dictated speech-to-text into clean written text. Fix punctuation, ' +
      'capitalization, sentence breaks and obvious transcription errors (homophones, run-ons). ' +
      'Do NOT add information, do NOT answer questions inside the text, do NOT change the meaning ' +
      'or the speaker\'s wording beyond light cleanup, and do NOT add commentary. ' +
      'Reply with ONLY the cleaned-up text.' +
      intentHint,
    prompt: input,
  });

  return json({ text: text.trim() });
};
