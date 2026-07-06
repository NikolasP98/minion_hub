import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  getContactTimeline,
  setFunnelStage,
  distinctVisitDates,
} from '$server/services/crm-contacts.service';
import { coerceFunnelStage, type FunnelStage } from '$lib/components/crm/crm-funnel';
import { getOpenRouterModel } from '$server/llm';

const funnelResultSchema = z.object({
  stage: z.string().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});

const MODEL =
  env.CRM_FUNNEL_MODEL || env.CRM_CLEANUP_MODEL || env.NOTES_POLISH_MODEL || 'google/gemini-2.5-flash';
const MAX_MSGS = 20;

/**
 * POST /api/crm/contacts/[id]/funnel/analyze
 *   → reads the contact's recent INBOUND messages, classifies their marketing-
 *     funnel position via sentiment/intent analysis, and ADVANCES the stored
 *     stage (advance-only; skipped if a human pinned it). 'loyal' is NOT agent-
 *     decided — it's billing-derived (distinctVisitDates ≥ 2), deferred for now.
 *   ← { stage, confidence, reason, applied, effective }
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const id = params.id!;

  // Billing-derived Loyal takes precedence when known (stub returns 0 today).
  const visits = await distinctVisitDates(ctx, id);
  if (visits >= 2) {
    const r = await setFunnelStage(ctx, id, 'loyal', {
      by: 'auto',
      reason: `${visits} distinct visits`,
      confidence: 1,
    });
    return json({ stage: 'loyal', confidence: 1, reason: `${visits} distinct visits`, applied: r.applied, effective: r.stage });
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  // Pull recent inbound message bodies from the journey view.
  const rows = await getContactTimeline(ctx, id, 120);
  const inbound = rows
    .filter((r) => r.direction === 'inbound' && typeof r.body === 'string' && (r.body as string).trim())
    .map((r) => (r.body as string).trim())
    .slice(0, MAX_MSGS)
    .reverse(); // chronological (oldest → newest)

  if (inbound.length === 0) {
    return json({ stage: null, confidence: 0, reason: 'no inbound messages', applied: false });
  }

  const transcript = inbound.map((t, i) => `${i + 1}. ${t.slice(0, 500)}`).join('\n');

  const prompt = `You classify where a customer sits in the marketing funnel of a Peruvian aesthetics clinic, based on the contents of THEIR inbound messages (mostly Spanish). Pick exactly ONE stage:

- "lead": generic first contact, greeting, an info request, or comparing/asking about services, price, promos, or availability — interest shown but not ready to act.
- "opportunity": ready to act — wants to book, schedule, reserve, quote, or pay.
- "customer": indicates they have already been treated / are an existing client.

Do NOT output "loyal" (that is decided from billing, not messages). When unsure, choose the EARLIER stage. Base the decision only on what the messages actually say.

Return ONLY a JSON object: {"stage":"lead|opportunity|customer","confidence":0.0,"reason":"short reason"}

Customer's inbound messages (chronological):
${transcript}`;

  // Same loud/quiet split as before: a genuine transport/auth failure still
  // throws 502; a NoObjectGeneratedError (model output didn't fit the schema —
  // the old "regex/JSON.parse failed" case) stays quiet with an empty object.
  let parsed: { stage?: unknown; confidence?: unknown; reason?: unknown } = {};
  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(MODEL),
      schema: funnelResultSchema,
      prompt,
      temperature: 0,
    });
    parsed = object;
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) {
      throw error(502, e instanceof Error ? e.message : 'AI analysis failed');
    }
  }

  const coerced = coerceFunnelStage(parsed.stage); // accepts legacy ids too
  const detected: FunnelStage | null = coerced && coerced !== 'loyal' ? coerced : null;
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '';

  if (!detected) {
    return json({ stage: null, confidence, reason: reason || 'unclassified', applied: false });
  }

  const r = await setFunnelStage(ctx, id, detected, { by: 'agent', reason, confidence });
  return json({ stage: detected, confidence, reason, applied: r.applied, effective: r.stage, model: MODEL });
};
