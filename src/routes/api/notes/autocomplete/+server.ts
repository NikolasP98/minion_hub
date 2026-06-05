import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
// Fast/cheap model for inline ghost text; override via env if a different model
// is provisioned on the OpenRouter key. Gemini Flash has very low time-to-first-
// token, which matters most for snappy Tab-to-accept autocomplete.
const DEFAULT_MODEL = env.NOTES_AUTOCOMPLETE_MODEL || 'google/gemini-2.0-flash-001';
const MAX_CONTEXT = 4000;

/**
 * POST /api/notes/autocomplete
 * Body: { kind: 'note' | 'todo', context: string }
 *
 *  - note → { suggestion: string }  (a short paragraph continuation)
 *  - todo → { items: string[] }     (suggested further checklist items)
 *
 * One-shot (non-streaming) — the caller shows it as Tab-to-accept ghost text.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const body = (await request.json().catch(() => ({}))) as { kind?: string; context?: string };
  const kind = body.kind === 'todo' ? 'todo' : 'note';
  const context = (body.context ?? '').slice(0, MAX_CONTEXT);

  const openrouter = createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    headers: { 'HTTP-Referer': 'https://hub.minion-ai.org', 'X-Title': 'Minion Hub - Notes Autofill' },
  });
  const model = openrouter(DEFAULT_MODEL);

  if (kind === 'todo') {
    const { text } = await generateText({
      model,
      maxOutputTokens: 160,
      temperature: 0.7,
      system:
        'You extend a user\'s todo checklist. Given the existing items, suggest 3 to 5 additional, ' +
        'concrete, relevant items. Reply with ONLY the new items, one per line, no numbering, ' +
        'no bullets, no commentary. Keep each item short.',
      prompt: context || '(empty checklist)',
    });
    const items = text
      .split('\n')
      .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l.length > 0)
      .slice(0, 5);
    return json({ items });
  }

  const { text } = await generateText({
    model,
    maxOutputTokens: 90,
    temperature: 0.6,
    system:
      'You are an inline autocomplete for a notes app. Continue the user\'s note naturally from ' +
      'exactly where it ends. Reply with ONLY the continuation text — no preamble, no quotes, no ' +
      'restating what they wrote. At most about 30 words. If the text ends mid-word, complete it.',
    prompt: context || '(empty note)',
  });
  let suggestion = text.trim();
  // If the note ends with a word char and the suggestion starts with one, add a space.
  if (context && /\w$/.test(context) && /^\w/.test(suggestion)) suggestion = ' ' + suggestion;
  return json({ suggestion });
};
