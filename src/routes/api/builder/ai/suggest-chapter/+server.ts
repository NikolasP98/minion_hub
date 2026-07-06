import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { getToolInfo } from '$lib/data/tool-manifest';
import { getOpenRouterModel, estimateCost } from '$server/llm';

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

const chapterSuggestionSchema = z.object({
  name: z.string().describe('Improved chapter name'),
  description: z.string().optional().describe('Role of this chapter in the pipeline'),
  triggerConditions: z.string().optional().describe('When this chapter activates'),
  guide: z.string().describe('Imperative bullet-point instructions (3-8 items)'),
  suggestedToolIds: z.array(z.string()).describe('Tool IDs from available pool'),
  context: z.string().optional().describe('Input data expectations from upstream'),
  outputDef: z.string().optional().describe('Concrete output data structure description'),
  successCriteria: z.string().optional().describe('Completion criteria'),
});

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({
      guide: '',
      suggestedToolIds: [],
      context: '',
      outputDef: '',
      error: 'OPENROUTER_API_KEY not configured',
    });
  }

  const body = await request.json();
  const { name, description, skillName, skillDescription, availableToolIds, model, targetField } =
    body;
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

Generate the guide (imperative instructions), suggested tool IDs from the available list, input context expectations, and output definition for this chapter.${targetField ? `\n\nIMPORTANT: Focus primarily on generating the "${targetField}" field. Return a thorough, focused suggestion for this field.` : ''}`;

  try {
    const { object, usage } = await generateObject({
      model: getOpenRouterModel(model || DEFAULT_MODEL),
      schema: chapterSuggestionSchema,
      maxOutputTokens: 1024,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub Builder' },
    });
    const parsed: Record<string, unknown> = object;

    // CFIX-03: Filter suggestedToolIds against available pool
    const availableSet = new Set<string>(availableToolIds ?? []);
    const rawSuggestedToolIds = (parsed.suggestedToolIds as string[]) ?? [];
    const validToolIds = rawSuggestedToolIds.filter((id) => availableSet.has(id));
    const removedToolIds = rawSuggestedToolIds.filter((id) => !availableSet.has(id));
    const filteredWarning =
      removedToolIds.length > 0
        ? `${removedToolIds.length} tool(s) not available in current pool were removed: ${removedToolIds.join(', ')}`
        : undefined;

    // CFIX-10: Extract usage and estimate cost
    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    const usedModel = model || DEFAULT_MODEL;

    // targetField: return only the requested field (AI-01: per-field wand)
    if (targetField && typeof parsed[targetField] === 'string') {
      return json({
        [targetField]: parsed[targetField],
        usage: {
          promptTokens,
          completionTokens,
          estimatedCost: estimateCost(usedModel, promptTokens, completionTokens),
        },
      });
    }

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
