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

const SYSTEM_PROMPT = `You are a skill-building assistant for an AI agent platform called OpenClaw. Given a subprocess chapter's name and description within a larger skill, generate suggestions for ALL fields following best practices for skill development.

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
- Success criteria should define what must be true when complete`;

const CHAPTER_SUGGESTION_SCHEMA = {
  type: 'object',
  required: ['name', 'guide', 'suggestedToolIds'],
  properties: {
    name: { type: 'string', description: 'Improved chapter name' },
    description: { type: 'string', description: 'Role of this chapter in the pipeline' },
    triggerConditions: { type: 'string', description: 'When this chapter activates' },
    guide: { type: 'string', description: 'Imperative bullet-point instructions (3-8 items)' },
    suggestedToolIds: { type: 'array', items: { type: 'string' }, description: 'Tool IDs from available pool' },
    context: { type: 'string', description: 'Input data expectations from upstream' },
    outputDef: { type: 'string', description: 'Concrete output data structure description' },
    successCriteria: { type: 'string', description: 'Completion criteria' },
  },
} as const;

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

  const toolDescriptions = (availableToolIds ?? [])
    .map((id: string) => {
      const info = getToolInfo(id);
      return `- ${info.id}: ${info.description}`;
    })
    .join('\n');

  // CFIX-07: Wrap user inputs in XML delimiters to prevent injection
  const userPrompt = `Skill: <skill_name>${skillName || 'Untitled Skill'}</skill_name>${skillDescription ? `\nSkill description: <skill_description>${skillDescription}</skill_description>` : ''}

Chapter: <chapter_name>${name}</chapter_name>${description ? `\nChapter description: <chapter_description>${description}</chapter_description>` : ''}

Available tools:
${toolDescriptions || '(none)'}

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
        tools: [{
          type: 'function',
          function: {
            name: 'suggest_chapter_fields',
            description: 'Generate suggested fields for a skill chapter',
            parameters: CHAPTER_SUGGESTION_SCHEMA,
          },
        }],
        tool_choice: { type: 'function', function: { name: 'suggest_chapter_fields' } },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai/suggest-chapter] OpenRouter error:', res.status, errText);
      return json({ guide: '', suggestedToolIds: [], context: '', outputDef: '', error: `OpenRouter returned ${res.status}` });
    }

    const completion = await res.json();

    // CFIX-05: Check for completion.error before attempting to parse choices
    if (completion.error) {
      console.error('[ai/suggest-chapter] completion.error:', completion.error);
      return json({
        name: '', description: '', triggerConditions: '', guide: '',
        suggestedToolIds: [], context: '', outputDef: '', successCriteria: '',
        error: completion.error?.message ?? JSON.stringify(completion.error) ?? 'AI returned an error',
      });
    }

    // Try tool_calls first (structured output), fall back to content parsing
    let parsed: Record<string, unknown>;
    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      parsed = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: parse from content (for models that don't support tool_choice)
      console.warn('[ai/suggest-chapter] No tool_calls in response — falling back to content parse');
      const content = completion.choices?.[0]?.message?.content ?? '';
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    }

    // CFIX-03: Filter suggestedToolIds against available pool
    const availableSet = new Set<string>(availableToolIds ?? []);
    const rawSuggestedToolIds = (parsed.suggestedToolIds as string[]) ?? [];
    const validToolIds = rawSuggestedToolIds.filter(id => availableSet.has(id));
    const removedToolIds = rawSuggestedToolIds.filter(id => !availableSet.has(id));
    const filteredWarning = removedToolIds.length > 0
      ? `${removedToolIds.length} tool(s) not available in current pool were removed: ${removedToolIds.join(', ')}`
      : undefined;

    // CFIX-10: Extract usage and estimate cost
    const rawUsage = completion.usage ?? {};
    const promptTokens = rawUsage.prompt_tokens ?? 0;
    const completionTokens = rawUsage.completion_tokens ?? 0;
    const usedModel = model || DEFAULT_MODEL;

    return json({
      name: (parsed.name as string) ?? '',
      description: (parsed.description as string) ?? '',
      triggerConditions: (parsed.triggerConditions as string) ?? '',
      guide: (parsed.guide as string) ?? '',
      suggestedToolIds: validToolIds,
      context: (parsed.context as string) ?? '',
      outputDef: (parsed.outputDef as string) ?? '',
      successCriteria: (parsed.successCriteria as string) ?? '',
      ...(filteredWarning ? { filteredToolIds: removedToolIds, warning: filteredWarning } : {}),
      usage: {
        promptTokens,
        completionTokens,
        estimatedCost: estimateCost(usedModel, promptTokens, completionTokens),
      },
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
