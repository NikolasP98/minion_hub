import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { recentNameFixes } from '$server/services/crm-cleanup.service';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = env.CRM_CLEANUP_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';
const MAX_ITEMS = 120;

/**
 * POST /api/crm/cleanup/review { items: [{id, current, proposed}] }
 *   → { results: [{id, name, action: 'keep'|'adjust'|'flag', note}] }
 *
 * Stage 2 of the hygiene pipeline: an LLM reviews the DETERMINISTIC name
 * proposals — fixing proper-noun casing the rules can't know, deriving a real
 * name from an email, and flagging entries that aren't names at all. It only
 * ever proposes a cleaned DISPLAY NAME; it never invents identity facts.
 */
const postSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        current: z.string().max(500).nullable().optional(),
        proposed: z.string().max(500).nullable().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const body = await parseBody(request, postSchema);
  const items = body.items.slice(0, MAX_ITEMS).map((i) => ({
    id: i.id,
    current: i.current ?? null,
    proposed: i.proposed ?? null,
  }));
  if (items.length === 0) return json({ results: [] });

  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const list = items
    .map(
      (i: { id: string; current: string | null; proposed: string | null }, n: number) =>
        `${n}\tcurrent="${i.current ?? ''}"\trule_proposed="${i.proposed ?? ''}"`,
    )
    .join('\n');

  // Few-shot: the org's own previously-accepted before→after fixes (training data).
  const examples = await recentNameFixes(ctx, 40).catch(() => []);
  const examplesBlock = examples.length
    ? `\nExamples of corrections THIS org has accepted before (mimic this style):\n${examples
        .map((e) => `"${e.before}" → "${e.after}"`)
        .join('\n')}\n`
    : '';

  const prompt = `You are cleaning a CRM contact list for a Peruvian aesthetics clinic. Most names are Spanish.
For each row, decide the best DISPLAY NAME. Rules:
- Proper Spanish capitalization (particles de/la/del/los lowercase mid-name; accents kept).
- Remove decorative/vanity symbols and emoji that are NOT part of the name ("~~Gabi~~"→"Gabi", "Shioko<3"→"Shioko", "K&ARA"→"Kara").
- But REPLACE a symbol/digit that stands in for a letter ("Miigu£l"→"Miguel", "Ęţşøņ"→"Etson", "ALEX4NDER"→"Alexander", "A1dair"→"Aldair"). Do NOT strip legitimate Spanish accents.
- Infer word boundaries in run-together names ("Melissabastosm"→"Melissa Bastos M.", "Fresiamurguiavilchez"→"Fresia Murguia Vilchez", "Mateoarriola065"→"Mateo Arriola"). Drop trailing digit noise.
- Trim leading/trailing whitespace.
- If the value is an email address, derive a plausible human name from the local-part ONLY (do not invent surnames); action="adjust".
- If it clearly is NOT a person's name (a sentence, a company disclaimer, gibberish, or a note like "es su prima de la paciente" / "no tiene número"), set name to "" and action="flag". These need a human.
- If the rule_proposed is already correct, action="keep" and name=rule_proposed.
- Otherwise action="adjust" with your corrected name.
${examplesBlock}Return ONLY a JSON array, one object per input index, shape:
[{"i":0,"name":"...","action":"keep|adjust|flag","note":"short reason"}]

Rows (index\\tcurrent\\trule_proposed):
${list}`;

  let text: string;
  try {
    const res = await generateText({ model: openrouter(MODEL), prompt, temperature: 0 });
    text = res.text;
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'AI review failed');
  }

  // Defensive parse: extract the first JSON array from the response.
  let parsed: Array<{ i: number; name?: string; action?: string; note?: string }> = [];
  try {
    const m = text.match(/\[[\s\S]*\]/);
    parsed = m ? JSON.parse(m[0]) : [];
  } catch {
    parsed = [];
  }

  const results = parsed
    .filter((p) => typeof p.i === 'number' && items[p.i])
    .map((p) => ({
      id: items[p.i].id,
      name: typeof p.name === 'string' ? p.name.trim() : (items[p.i].proposed ?? ''),
      action: p.action === 'flag' || p.action === 'adjust' || p.action === 'keep' ? p.action : 'keep',
      note: typeof p.note === 'string' ? p.note.slice(0, 200) : '',
    }));

  return json({ results, model: MODEL });
};
