import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const { name, role, category, personality } = body as {
    name?: string;
    role?: string;
    category?: string;
    personality?: {
      catchphrase?: string;
      formalCasual?: number;  // 0=formal, 100=casual
      cautiousBold?: number;  // 0=cautious, 100=bold
      technicalStrategic?: number; // 0=technical, 100=strategic
    };
  };

  if (!name || !role || !category) throw error(400, 'name, role, and category are required');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw error(500, 'ANTHROPIC_API_KEY not configured');

  const formalCasual = personality?.formalCasual ?? 50;
  const cautiousBold = personality?.cautiousBold ?? 50;
  const technicalStrategic = personality?.technicalStrategic ?? 50;

  const toneDesc = formalCasual < 30 ? 'formal and professional' : formalCasual > 70 ? 'casual and approachable' : 'balanced between formal and casual';
  const riskDesc = cautiousBold < 30 ? 'cautious and thorough' : cautiousBold > 70 ? 'bold and decisive' : 'balanced between cautious and bold';
  const thinkingDesc = technicalStrategic < 30 ? 'deeply technical' : technicalStrategic > 70 ? 'strategic and big-picture' : 'both technical and strategic';

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
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw error(502, `Anthropic API error: ${errText}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const rawText = data.content.find((c) => c.type === 'text')?.text ?? '';
    const parsed = JSON.parse(rawText) as {
      soulMd: string;
      identityMd: string;
      userMd: string;
      contextMd: string;
      skillsMd: string;
      agentJson: {
        id: string;
        name: string;
        role: string;
        category: string;
        tags: string[];
        description: string;
        catchphrase: string;
        version: string;
        model: string;
        avatarSeed: string;
      };
    };

    return json(parsed);
  } catch (err) {
    if (err instanceof Response) throw err;
    throw error(500, `Generation failed: ${(err as Error).message}`);
  }
};
