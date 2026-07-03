import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

/**
 * Simulates executing a single skill chapter.
 * Receives the chapter's instructions + upstream context, returns what the agent would produce.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });

  const body = await request.json();
  const {
    chapterName,
    guide,
    context: inputContext,
    outputDef,
    toolIds,
    userPrompt,
    upstreamOutputs,
    model,
  } = body;

  if (!chapterName || !userPrompt) throw error(400, 'chapterName and userPrompt are required');

  const toolList = (toolIds ?? []).join(', ') || '(none)';
  const upstreamSection = upstreamOutputs?.length
    ? `\nUPSTREAM CHAPTER OUTPUTS (data available to you):\n${upstreamOutputs.map((u: { chapterName: string; output: string }) => `--- ${u.chapterName} ---\n${u.output}`).join('\n\n')}`
    : '';

  const systemPrompt = `You are simulating the execution of a skill chapter in a dry-run. You are role-playing as an AI agent that follows the chapter's instructions precisely.

RULES:
- Follow the chapter instructions (guide) exactly
- Use ONLY the information provided (user prompt + upstream outputs)
- Produce output matching the output definition format
- Do NOT use any external tools — simulate what you would produce
- Keep output concise but realistic (150-300 words max)
- If a tool would normally be used, describe what you would do with it and produce a plausible result`;

  const userMessage = `CHAPTER: ${chapterName}

INSTRUCTIONS:
${guide || '(no instructions provided)'}

INPUT CONTEXT:
${inputContext || '(no input context defined)'}

EXPECTED OUTPUT FORMAT:
${outputDef || '(no output format defined)'}

AVAILABLE TOOLS: ${toolList}
${upstreamSection}

USER PROMPT: ${userPrompt}

Simulate executing this chapter. Produce realistic output matching the expected format.`;

  try {
    const startMs = Date.now();
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': hubBaseUrl(),
        'X-Title': 'Minion Hub Builder - Dry Run',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai/dry-run] OpenRouter error:', res.status, errText);
      return json({ error: `AI returned ${res.status}` }, { status: 502 });
    }

    const completion = await res.json();
    if (completion.error) {
      return json({ error: completion.error?.message ?? 'AI error' }, { status: 502 });
    }

    const output = completion.choices?.[0]?.message?.content ?? '';
    const durationMs = Date.now() - startMs;
    const usage = completion.usage ?? {};

    return json({
      output,
      durationMs,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      },
    });
  } catch (e) {
    console.error('[ai/dry-run]', e);
    return json({ error: e instanceof Error ? e.message : 'Dry run failed' }, { status: 500 });
  }
};
