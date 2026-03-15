import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';

const SYSTEM_PROMPT = `You are a skill-building assistant for an AI agent platform called OpenClaw. Given a subprocess chapter's name and description within a larger skill, generate suggestions for ALL fields following Anthropic's best practices for skill development.

RULES:
- Write ALL instructions in imperative/infinitive form (verb-first): "Search for X", "Extract data from Y", "Validate output against Z"
- NEVER use second person: no "You should", "You need to", "You can"
- Be specific and actionable, not vague
- Keep instructions concise: 3-8 bullet points, each starting with an action verb
- Tool suggestions must come from the available pool only
- Output definitions should describe concrete data structures or artifacts
- Input context should describe what data flows in from upstream
- The name suggestion should be a clear, concise subprocess name
- The description should explain the subprocess's role in the pipeline
- Trigger conditions should specify when this subprocess activates
- Success criteria should define what must be true when complete

Respond with ONLY valid JSON, no markdown fences or explanation:
{
  "name": "Improved Chapter Name",
  "description": "Clear description of what this subprocess does in the pipeline",
  "triggerConditions": "When upstream provides X, After Y completes",
  "guide": "- Search the web for relevant sources on the topic\\n- Extract key findings from top 3 results\\n- Cross-reference findings against known data",
  "suggestedToolIds": ["web_search", "web_fetch"],
  "context": "Receives a research topic string and optional list of seed URLs from the upstream chapter",
  "outputDef": "Structured JSON array of findings, each with: title, source URL, key points (string[]), confidence score (0-1)",
  "successCriteria": "All sources have been verified, Output contains at least 3 data points with confidence > 0.7"
}`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ guide: '', suggestedToolIds: [], context: '', outputDef: '', error: 'OPENROUTER_API_KEY not configured' });
  }

  const body = await request.json();
  const { name, description, skillName, skillDescription, availableToolIds, model } = body;
  if (!name) throw error(400, 'Chapter name is required');

  const userPrompt = `Skill: "${skillName || 'Untitled Skill'}"${skillDescription ? ` — ${skillDescription}` : ''}

Chapter: "${name}"${description ? ` — ${description}` : ''}

Available tool IDs: ${(availableToolIds ?? []).join(', ') || 'none'}

Generate the guide (imperative instructions), suggested tool IDs from the available list, input context expectations, and output definition for this chapter.`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://minionhub.admin-console.dev',
        'X-Title': 'Minion Hub Builder',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai/suggest-chapter] OpenRouter error:', res.status, errText);
      return json({ guide: '', suggestedToolIds: [], context: '', outputDef: '', error: `OpenRouter returned ${res.status}` });
    }

    const completion = await res.json();
    const content = completion.choices?.[0]?.message?.content ?? '';

    // Parse JSON from the response (handle potential markdown fences)
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return json({
      name: parsed.name ?? '',
      description: parsed.description ?? '',
      triggerConditions: parsed.triggerConditions ?? '',
      guide: parsed.guide ?? '',
      suggestedToolIds: parsed.suggestedToolIds ?? [],
      context: parsed.context ?? '',
      outputDef: parsed.outputDef ?? '',
      successCriteria: parsed.successCriteria ?? '',
    });
  } catch (e) {
    console.error('[ai/suggest-chapter]', e);
    return json({
      name: '',
      description: '',
      triggerConditions: '',
      guide: '',
      suggestedToolIds: [],
      context: '',
      outputDef: '',
      successCriteria: '',
      error: e instanceof Error ? e.message : 'AI suggestion failed',
    });
  }
};
