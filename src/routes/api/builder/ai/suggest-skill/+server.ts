import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { getToolInfo } from '$lib/data/tool-manifest';

const MODEL_PRICE_TABLE: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'anthropic/claude-sonnet-4': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'anthropic/claude-haiku-3': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'openai/gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const prices = MODEL_PRICE_TABLE[model];
  if (!prices) return 0;
  return (promptTokens / 1_000_000) * prices.inputPerMillion +
         (completionTokens / 1_000_000) * prices.outputPerMillion;
}

const SYSTEM_PROMPT = `You are a skill architect for an AI agent platform called OpenClaw. Given a skill description and the list of available tools, design a complete execution pipeline as a directed graph of chapters (cycles are supported and bounded by maxCycles) and optional condition nodes.

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
- Each chapter name MUST be unique within the skill
- Use chapter names (not indices) when defining edges

EXAMPLES:

Example 1 — Linear research pipeline:
chapters:
  [{ type: "chapter", name: "Web Research", description: "Search and gather sources on the topic", guide: "- Search the web for relevant sources on the given topic\\n- Fetch the top 5 results and extract key content", toolIds: ["web_search", "web_fetch"], context: "Receives user query string", outputDef: "Array of source URLs with extracted excerpts", positionX: 300, positionY: 0 },
   { type: "chapter", name: "Synthesis", description: "Analyze and synthesize findings", guide: "- Extract key facts from gathered sources\\n- Cross-reference claims across sources\\n- Compile a structured summary", toolIds: ["web_fetch"], context: "Array of source URLs with extracted excerpts", outputDef: "Structured summary with citations and confidence scores", positionX: 300, positionY: 180 }]
edges:
  [{ fromName: "Web Research", toName: "Synthesis", label: null }]

Example 2 — Conditional pipeline with branching:
chapters:
  [{ type: "chapter", name: "Data Collection", description: "Gather initial data from web sources", guide: "- Search for data points related to the topic\\n- Extract quantitative data from results", toolIds: ["web_search", "web_fetch"], context: "Receives research topic", outputDef: "Array of data points with source attribution", positionX: 300, positionY: 0 },
   { type: "condition", name: "Sufficient Data?", conditionText: "Are there at least 3 verified data points?", positionX: 300, positionY: 180 },
   { type: "chapter", name: "Deep Dive", description: "Gather additional data from deeper sources", guide: "- Use browser to access paywalled or complex sources\\n- Extract additional data points", toolIds: ["browser", "web_fetch"], context: "Insufficient data from initial collection", outputDef: "Additional data points from deeper sources", positionX: 100, positionY: 360 },
   { type: "chapter", name: "Generate Report", description: "Compile final report from collected data", guide: "- Organize all data points by category\\n- Write executive summary\\n- Include source citations", toolIds: ["web_fetch"], context: "Verified collection of data points (3+ sources)", outputDef: "Structured report with sections, data tables, and citations", positionX: 300, positionY: 360 }]
edges:
  [{ fromName: "Data Collection", toName: "Sufficient Data?", label: null },
   { fromName: "Sufficient Data?", toName: "Generate Report", label: "Yes" },
   { fromName: "Sufficient Data?", toName: "Deep Dive", label: "No" },
   { fromName: "Deep Dive", toName: "Data Collection", label: null }]`;

const SKILL_PIPELINE_SCHEMA = {
  type: 'object',
  required: ['chapters', 'edges'],
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'name'],
        properties: {
          type: { type: 'string', enum: ['chapter', 'condition'] },
          name: { type: 'string', description: 'Unique chapter name' },
          description: { type: 'string' },
          guide: { type: 'string', description: 'Imperative instructions (verb-first bullet points)' },
          toolIds: { type: 'array', items: { type: 'string' } },
          context: { type: 'string', description: 'What data this chapter receives from upstream' },
          outputDef: { type: 'string', description: 'What data this chapter produces' },
          conditionText: { type: 'string', description: 'Binary yes/no question (condition nodes only)' },
          positionX: { type: 'number' },
          positionY: { type: 'number' },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fromName', 'toName'],
        properties: {
          fromName: { type: 'string', description: 'Name of the source chapter' },
          toName: { type: 'string', description: 'Name of the target chapter' },
          label: {
            anyOf: [
              { type: 'string', enum: ['Yes', 'No'] },
              { type: 'null' },
            ],
            description: 'Branch label for condition edges (Yes/No for condition nodes, null for regular edges)',
          },
        },
      },
    },
  },
} as const;

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

  const toolDescriptions = (availableToolIds ?? [])
    .map((id: string) => {
      const info = getToolInfo(id);
      return `- ${info.id}: ${info.description}`;
    })
    .join('\n');

  const userPrompt = `Skill: <skill_name>${name || 'Untitled Skill'}</skill_name>
Description: <skill_description>${description}</skill_description>

Available tools:
${toolDescriptions || '(none)'}

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
        tools: [{
          type: 'function',
          function: {
            name: 'create_skill_pipeline',
            description: 'Create a skill execution pipeline with chapters and directed edges',
            parameters: SKILL_PIPELINE_SCHEMA,
          },
        }],
        tool_choice: { type: 'function', function: { name: 'create_skill_pipeline' } },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai/suggest-skill] OpenRouter error:', res.status, errText);
      return json({ error: `OpenRouter returned ${res.status}` }, { status: 502 });
    }

    const completion = await res.json();

    // CFIX-05: Check for completion.error before attempting to parse choices
    if (completion.error) {
      console.error('[ai/suggest-skill] completion.error:', completion.error);
      return json({ error: completion.error?.message ?? JSON.stringify(completion.error) ?? 'AI returned an error' }, { status: 502 });
    }

    // Try tool_calls first (structured output), fall back to content parsing
    let parsed: { chapters?: unknown[]; edges?: unknown[] };
    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      parsed = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: parse from content (for models that don't support tool_choice)
      console.warn('[ai/suggest-skill] No tool_calls in response — falling back to content parse');
      const content = completion.choices?.[0]?.message?.content ?? '';
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    }

    const chapters = (parsed.chapters ?? []) as Array<{ name: string; [k: string]: unknown }>;

    // CFIX-03: Filter tool IDs against available pool
    const availableSet = new Set<string>(availableToolIds ?? []);
    const filteredToolIds: string[] = [];

    for (const ch of chapters) {
      if (ch.toolIds && Array.isArray(ch.toolIds)) {
        const before = ch.toolIds as string[];
        const removed = before.filter((id: string) => !availableSet.has(id));
        filteredToolIds.push(...removed);
        (ch as Record<string, unknown>).toolIds = before.filter((id: string) => availableSet.has(id));
      }
    }

    const warning = filteredToolIds.length > 0
      ? `${filteredToolIds.length} tool(s) not available in current pool were removed: ${filteredToolIds.join(', ')}`
      : undefined;

    // Resolve name-based edges to index-based for frontend compatibility
    const edges = ((parsed.edges ?? []) as Array<{ fromName?: string; toName?: string; from?: number; to?: number; label?: string | null }>)
      .map(e => {
        // Handle both name-based and legacy index-based edges
        if (typeof e.fromName === 'string' && typeof e.toName === 'string') {
          return {
            from: chapters.findIndex(ch => ch.name === e.fromName),
            to: chapters.findIndex(ch => ch.name === e.toName),
            label: e.label ?? null,
          };
        }
        return { from: e.from ?? -1, to: e.to ?? -1, label: e.label ?? null };
      })
      .filter(e => e.from >= 0 && e.to >= 0);

    // CFIX-10: Extract usage and estimate cost
    const rawUsage = completion.usage ?? {};
    const promptTokens = rawUsage.prompt_tokens ?? 0;
    const completionTokens = rawUsage.completion_tokens ?? 0;
    const usedModel = model || DEFAULT_MODEL;

    return json({
      chapters,
      edges,
      ...(warning ? { filteredToolIds, warning } : {}),
      usage: {
        promptTokens,
        completionTokens,
        estimatedCost: estimateCost(usedModel, promptTokens, completionTokens),
      },
    });
  } catch (e) {
    console.error('[ai/suggest-skill]', e);
    return json({
      error: e instanceof Error ? e.message : 'AI suggestion failed',
    }, { status: 500 });
  }
};
