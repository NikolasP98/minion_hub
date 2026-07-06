import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { getOpenRouterModel } from '$server/llm';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

const promptsSchema = z.object({
  prompts: z.array(
    z.object({
      text: z.string().describe('The full test prompt a user would send to trigger this skill'),
      label: z.string().describe('Short 2-4 word label for the pill button'),
    }),
  ),
});

/**
 * Generates 3 suggested test prompts based on the skill's current chapters,
 * tools, and description. Prompts are realistic user messages that would
 * exercise the pipeline end-to-end.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ prompts: [] });

  const body = await request.json();
  const { skillName, skillDescription, chapters, model } = body;

  if (!chapters?.length) return json({ prompts: [] });

  const chapterSummary = chapters
    .map(
      (ch: {
        name: string;
        description: string;
        guide: string;
        context: string;
        toolIds: string[];
      }) =>
        `- "${ch.name}": ${ch.description || ch.guide?.slice(0, 80) || '(no description)'}${ch.toolIds?.length ? ` [tools: ${ch.toolIds.join(', ')}]` : ''}${ch.context ? ` [expects: ${ch.context.slice(0, 60)}]` : ''}`,
    )
    .join('\n');

  const userMessage = `Skill: "${skillName}"
Description: ${skillDescription || '(none)'}

Pipeline chapters:
${chapterSummary}

Generate exactly 3 realistic test prompts that a user would send to trigger this skill. Each prompt should:
1. Be a natural, specific user request (not generic)
2. Provide enough context for the FIRST chapter to start working
3. Exercise a different aspect of the pipeline (happy path, edge case, complex input)
4. Be 1-2 sentences long

Each prompt needs a short 2-4 word label for a pill button.`;

  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(model || DEFAULT_MODEL),
      schema: promptsSchema,
      maxOutputTokens: 512,
      system:
        'You generate realistic test prompts for AI skill pipelines. Return exactly 3 prompts via the tool call.',
      prompt: userMessage,
      headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub Builder - Prompt Suggestions' },
    });
    return json({ prompts: object.prompts.slice(0, 3) });
  } catch {
    return json({ prompts: [] });
  }
};
