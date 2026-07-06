import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getOpenRouterModel } from '$server/llm';

// Was a direct api.anthropic.com call keyed on ANTHROPIC_API_KEY; routed through
// the shared OpenRouter factory (no ANTHROPIC_API_KEY-specific requirement, and
// no @ai-sdk/anthropic dependency needed) — same model family as the original
// hardcoded 'claude-sonnet-4-6'.
const DEFAULT_MODEL = env.MARKETPLACE_GENERATE_AGENT_MODEL || 'anthropic/claude-sonnet-4';

const agentPersonaSchema = z.object({
  soulMd: z.string(),
  identityMd: z.string(),
  userMd: z.string(),
  contextMd: z.string(),
  skillsMd: z.string(),
  agentJson: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    description: z.string(),
    catchphrase: z.string(),
    version: z.string(),
    model: z.string(),
    avatarSeed: z.string(),
  }),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const { name, role, category, personality } = body as {
    name?: string;
    role?: string;
    category?: string;
    personality?: {
      catchphrase?: string;
      formalCasual?: number; // 0=formal, 100=casual
      cautiousBold?: number; // 0=cautious, 100=bold
      technicalStrategic?: number; // 0=technical, 100=strategic
    };
  };

  if (!name || !role || !category) throw error(400, 'name, role, and category are required');

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(500, 'OPENROUTER_API_KEY not configured');

  const formalCasual = personality?.formalCasual ?? 50;
  const cautiousBold = personality?.cautiousBold ?? 50;
  const technicalStrategic = personality?.technicalStrategic ?? 50;

  const toneDesc =
    formalCasual < 30
      ? 'formal and professional'
      : formalCasual > 70
        ? 'casual and approachable'
        : 'balanced between formal and casual';
  const riskDesc =
    cautiousBold < 30
      ? 'cautious and thorough'
      : cautiousBold > 70
        ? 'bold and decisive'
        : 'balanced between cautious and bold';
  const thinkingDesc =
    technicalStrategic < 30
      ? 'deeply technical'
      : technicalStrategic > 70
        ? 'strategic and big-picture'
        : 'both technical and strategic';

  const prompt = `You are creating a fictional human professional persona for an AI assistant agent named ${name}, who works as a ${role} in the ${category} domain.

Their tone is ${toneDesc}. They are ${riskDesc}. They think ${thinkingDesc}.
${personality?.catchphrase ? `Their catchphrase is: "${personality.catchphrase}"` : ''}

Write five identity documents for this person. They must NEVER reference being an AI, a bot, or a language model — they are a real person with a real life, history, and personality.

Return your response as a JSON object with exactly these fields:
- soulMd: Their internal values, fears, dreams, and what drives them (500-700 words markdown)
- identityMd: Age, city, background, education, family, hobbies, daily habits (400-600 words markdown)
- userMd: How they address the user, their communication style, what they do/don't do (300-400 words markdown)
- contextMd: Their professional toolkit, daily work routine, how they approach problems (400-500 words markdown)
- skillsMd: Their professional skills with brief notes on their approach to each (400-500 words markdown)
- agentJson: A JSON object (not a string) with: id (slug from name), name, role, category, tags (array of 4-6 strings), description (2-3 sentences), catchphrase, version ("1.0.0"), model ("claude-sonnet-4-6"), avatarSeed (slug from name)

Return only valid JSON, no markdown code fences.`;

  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(DEFAULT_MODEL),
      schema: agentPersonaSchema,
      maxOutputTokens: 8000,
      prompt,
    });
    return json(object);
  } catch (err) {
    if (err instanceof Response) throw err;
    throw error(500, `Generation failed: ${(err as Error).message}`);
  }
};
