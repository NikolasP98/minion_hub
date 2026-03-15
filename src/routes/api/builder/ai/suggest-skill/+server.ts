import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';

const SYSTEM_PROMPT = `You are a skill architect for an AI agent platform called OpenClaw. Given a skill description and the list of available tools, design a complete execution pipeline as a directed acyclic graph (DAG) of chapters and optional condition nodes.

RULES:
- Each chapter is a subprocess that performs a specific task using the available tools
- Condition nodes are binary decision points — they ask a yes/no question to branch the flow
- Condition text MUST be a clear binary question: "Is X?", "Does Y?", "Has Z?" — never subjective
- Write ALL chapter instructions in imperative/infinitive form (verb-first): "Search for X", "Extract data from Y"
- NEVER use second person: no "You should", "You need to"
- Design 2-6 chapters that form a logical pipeline
- Only suggest tools from the available pool
- Position chapters in a top-to-bottom layout (increment Y by ~180 per level)
- Conditions branch the flow: one edge labeled "Yes", another labeled "No"

Respond with ONLY valid JSON, no markdown fences:
{
  "chapters": [
    {
      "type": "chapter",
      "name": "Research Phase",
      "description": "Gather and analyze sources",
      "guide": "- Search the web for relevant sources\\n- Extract key findings",
      "toolIds": ["web_search", "web_fetch"],
      "context": "Receives the user's query",
      "outputDef": "Array of source summaries",
      "positionX": 300,
      "positionY": 0
    },
    {
      "type": "condition",
      "name": "Sufficient Data?",
      "conditionText": "Are there at least 3 verified sources?",
      "positionX": 300,
      "positionY": 180
    }
  ],
  "edges": [
    { "from": 0, "to": 1, "label": null },
    { "from": 1, "to": 2, "label": "Yes" },
    { "from": 1, "to": 0, "label": "No" }
  ]
}`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
  }

  const body = await request.json();
  const { name, description, availableToolIds, model } = body;
  if (!description?.trim()) throw error(400, 'Skill description is required');

  const userPrompt = `Skill: "${name || 'Untitled Skill'}"
Description: ${description}

Available tool IDs: ${(availableToolIds ?? []).join(', ') || 'none'}

Design a complete chapter pipeline for this skill. Include condition nodes where branching logic is needed. Each chapter must use only tools from the available list.`;

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
        max_tokens: 2048,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai/suggest-skill] OpenRouter error:', res.status, errText);
      return json({ error: `OpenRouter returned ${res.status}` }, { status: 502 });
    }

    const completion = await res.json();
    const content = completion.choices?.[0]?.message?.content ?? '';
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return json({
      chapters: parsed.chapters ?? [],
      edges: parsed.edges ?? [],
    });
  } catch (e) {
    console.error('[ai/suggest-skill]', e);
    return json({
      error: e instanceof Error ? e.message : 'AI suggestion failed',
    }, { status: 500 });
  }
};
