import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { requireAuth } from '$server/auth/authorize';
import { getOpenRouterModel } from '$server/llm';

const DEFAULT_MODEL = env.NOTES_REFINE_MODEL || env.NOTES_AUTOCOMPLETE_MODEL || 'google/gemini-2.5-flash';
const MAX_INPUT = 8000;

// Note-polish intents bias the title style (distinct from transcription intents).
const INTENT_HINTS: Record<string, string> = {
  meeting: 'Treat this as meeting notes — titles should name the meeting/topic and surface decisions.',
  short: 'Prefer terse, punchy titles (2–4 words).',
  long: 'Allow descriptive, fuller titles (a short sentence is fine).',
  formal: 'Use a professional, formal tone for titles.',
  actions: 'Frame titles around the actions/next-steps captured in the content.',
};

const blockInputSchema = z.object({
  id: z.string(),
  type: z.enum(['text', 'todo', 'easel']),
  title: z.string().optional(),
  content: z.string().optional(),
});

const requestSchema = z.object({
  intent: z.string().optional(),
  title: z.string().optional(),
  blocks: z.array(blockInputSchema).default([]),
});

const resultSchema = z.object({
  title: z.string().describe('A concise title for the whole note'),
  blocks: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .describe('A short title for each titleless to-do/easel block, keyed by its id'),
  textBlocks: z
    .array(z.object({ id: z.string(), body: z.string() }))
    .describe(
      'A cleaned-up rewrite of each TEXT block (keyed by its id), in the same Markdown format — ' +
        'fix grammar/flow/structure per the intent but keep ALL facts and meaning; return the ' +
        'original text unchanged if it is already clean',
    ),
});

/**
 * POST /api/notes/refine
 * Body: { intent?, title?, blocks: [{id, type, title?, content?}] }
 *   → { title, blocks: [{id, title}] }
 *
 * AI "polish" for a note: proposes a note title and titles for its embedded
 * to-do/easel blocks, biased by `intent`. The client applies these only where a
 * title is currently empty. Never rewrites the note body.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, 'Invalid request');
  const { intent, title, blocks } = parsed.data;
  const intentHint = intent ? (INTENT_HINTS[intent] ?? '') : '';

  // Compose a compact textual view of the note for the model.
  const lines: string[] = [];
  lines.push(`Note title: ${title?.trim() || '(empty)'}`);
  for (const b of blocks) {
    const c = (b.content ?? '').slice(0, 1200).trim();
    lines.push(
      `\nBlock id=${b.id} type=${b.type} title=${b.title?.trim() || '(empty)'}\n${c || '(no content)'}`,
    );
  }
  const doc = lines.join('\n').slice(0, MAX_INPUT);

  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(DEFAULT_MODEL),
      schema: resultSchema,
      temperature: 0.4,
      maxOutputTokens: 1500,
      headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub - Notes Refine' },
      system:
        'You polish notes. Given a note and its embedded blocks, produce: (1) a concise, specific ' +
        'title for the note and for each to-do/easel block, derived strictly from the content; and ' +
        '(2) a cleaned-up rewrite of every TEXT block, in the same Markdown format — improve ' +
        'grammar, flow and structure per the intent but KEEP all facts and meaning and do not add ' +
        'new information. If a text block is already clean, return it unchanged. Reference each ' +
        'block by the exact id given. ' +
        intentHint,
      prompt: doc,
    });
    // Only return entries for ids we were given.
    const ids = new Set(blocks.map((b) => b.id));
    const textIds = new Set(blocks.filter((b) => b.type === 'text').map((b) => b.id));
    return json({
      title: object.title?.trim() ?? '',
      blocks: object.blocks.filter((b) => ids.has(b.id)).map((b) => ({ id: b.id, title: b.title.trim() })),
      textBlocks: (object.textBlocks ?? [])
        .filter((b) => textIds.has(b.id))
        .map((b) => ({ id: b.id, body: b.body })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('[notes/refine] model call failed:', msg);
    throw error(502, `Refine failed: ${msg}`);
  }
};
