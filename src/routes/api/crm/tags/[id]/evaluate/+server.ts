import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getTag, getAiTagCandidates, applyTagBulk } from '$server/services/crm-contacts.service';
import { getOpenRouterModel } from '$server/llm';

const evalItemSchema = z.object({ i: z.number(), qualifies: z.boolean() });

const MODEL =
  env.CRM_TAG_MODEL || env.CRM_FUNNEL_MODEL || env.CRM_CLEANUP_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';
const BATCH = 15; // candidates per LLM call

/**
 * POST /api/crm/tags/[id]/evaluate
 *   Runs the AI tag's qualification description against candidate contacts'
 *   recent inbound messages and APPLIES the tag to those that match. Bounded by
 *   getAiTagCandidates' cap (cost). Additive + idempotent (un-applying contacts
 *   that no longer qualify is a follow-up).
 *   ← { evaluated, matched, applied, model }
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const tag = await getTag(ctx, params.id!);
  if (!tag) throw error(404, 'tag not found');
  if (tag.kind !== 'ai') throw error(400, 'not an AI tag');
  const description = (tag.rule as { description?: unknown } | null)?.description;
  if (typeof description !== 'string' || !description.trim()) {
    throw error(400, 'AI tag has no description');
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const candidates = (await getAiTagCandidates(ctx, { cap: 120 })).filter((c) => c.snippets.length > 0);
  if (candidates.length === 0) return json({ evaluated: 0, matched: 0, applied: 0 });

  const matchedIds: string[] = [];

  for (let start = 0; start < candidates.length; start += BATCH) {
    const batch = candidates.slice(start, start + BATCH);
    const list = batch
      .map((c, i) => {
        const msgs = c.snippets.map((s) => `   - ${s.replace(/\s+/g, ' ')}`).join('\n');
        return `${i}\tname="${c.name ?? ''}"\n${msgs}`;
      })
      .join('\n\n');

    const prompt = `You tag CRM contacts of a Peruvian aesthetics clinic. Most messages are Spanish.
Decide which contacts QUALIFY for this tag based ONLY on the contents/sentiment of THEIR inbound messages.

Tag: "${tag.name}"
Qualifies when: ${description.trim()}

Be conservative — only mark a contact as qualifying when their messages clearly match. Do not invent facts.
Return ONLY a JSON array with one object per input index:
[{"i":0,"qualifies":true|false}]

Contacts (index, name, recent inbound messages):
${list}`;

    let parsed: Array<{ i: number; qualifies?: unknown }> = [];
    try {
      const { object } = await generateObject({
        model: getOpenRouterModel(MODEL),
        output: 'array',
        schema: evalItemSchema,
        prompt,
        temperature: 0,
      });
      parsed = object;
    } catch {
      continue; // a failed batch shouldn't abort the whole run
    }
    for (const p of parsed) {
      if (typeof p.i === 'number' && p.qualifies === true && batch[p.i]) {
        matchedIds.push(batch[p.i].contactId);
      }
    }
  }

  const applied = await applyTagBulk(ctx, tag.id, matchedIds);
  return json({ evaluated: candidates.length, matched: matchedIds.length, applied, model: MODEL });
};
