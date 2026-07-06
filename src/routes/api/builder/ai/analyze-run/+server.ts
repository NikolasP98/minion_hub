import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { getOpenRouterModel } from '$server/llm';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

const analysisSchema = z.object({
  overallScore: z.number().describe('Overall quality score 0-100'),
  dimensions: z.array(
    z.object({
      name: z.string().describe('Dimension name'),
      score: z.number().describe('Score 0-100 for this dimension'),
      verdict: z.enum(['pass', 'warn', 'fail']),
      details: z.string().describe('Brief explanation (1-2 sentences)'),
    }),
  ),
  recommendations: z.array(z.string()).optional().describe('Top 3 actionable improvements'),
});

/**
 * Analyzes a completed dry run — evaluates output consistency, pipeline flow,
 * tool coverage, timing, and token budget.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });

  const body = await request.json();
  const { skillName, skillDescription, chapters, results, totalTokens, totalDurationMs, model } =
    body;

  if (!results?.length) throw error(400, 'No results to analyze');

  // Build the analysis prompt with all chapter definitions and outputs
  const chapterDetails = chapters
    .map(
      (
        ch: { name: string; guide: string; outputDef: string; context: string; toolIds: string[] },
        i: number,
      ) => {
        const result = results[i];
        return `
## Chapter ${i + 1}: ${ch.name}
**Instructions (guide):** ${ch.guide || '(none)'}
**Expected output format (outputDef):** ${ch.outputDef || '(none)'}
**Expected input (context):** ${ch.context || '(none)'}
**Tools assigned:** ${ch.toolIds?.join(', ') || '(none)'}
**Actual output:** ${result?.output || '(no output)'}
**Status:** ${result?.status ?? 'unknown'}
**Duration:** ${result?.durationMs ?? 0}ms
**Tokens:** ${(result?.promptTokens ?? 0) + (result?.completionTokens ?? 0)}`;
      },
    )
    .join('\n');

  const systemPrompt = `You are a skill pipeline quality analyst. Analyze the dry-run results of an AI skill pipeline and score it across 6 dimensions.

SCORING RULES:
- Score each dimension 0-100
- "pass" = 70+, "warn" = 40-69, "fail" = 0-39
- Be honest and specific — vague praise is useless
- Compare each chapter's actual output against its outputDef
- Check if upstream outputs properly feed downstream chapters
- Flag chapters whose guide mentions tools but no tools are assigned
- Flag chapters taking >5 seconds or using >2000 tokens as expensive`;

  const userMessage = `SKILL: ${skillName}
DESCRIPTION: ${skillDescription}

TOTAL METRICS: ${totalTokens} tokens, ${totalDurationMs}ms, ${results.length} chapters

${chapterDetails}

Analyze this pipeline across these 6 dimensions:

1. **Output Consistency** — Does each chapter's actual output match its defined outputDef format? Are outputs structured, complete, and usable?
2. **Pipeline Flow** — Do upstream outputs logically feed into downstream chapter inputs? Is the data handoff clean?
3. **Tool Coverage** — Do chapters that mention tool usage in their guide have the right tools assigned? Are any tools missing or unnecessary?
4. **Instruction Quality** — Are the chapter guides specific enough to produce consistent results? Would different runs produce similar outputs?
5. **Timing Efficiency** — Are any chapters disproportionately slow? Is the total pipeline duration reasonable?
6. **Token Budget** — Is the total token usage reasonable for the pipeline's complexity? Are any chapters wastefully verbose?

Return an overall score (0-100) and per-dimension scores with pass/warn/fail verdicts.
Include top 3 actionable recommendations for improvement.`;

  try {
    const { object } = await generateObject({
      model: getOpenRouterModel(model || DEFAULT_MODEL),
      schema: analysisSchema,
      maxOutputTokens: 1024,
      system: systemPrompt,
      prompt: userMessage,
      headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub Builder - Run Analysis' },
    });
    return json(object);
  } catch (e) {
    console.error('[ai/analyze-run]', e);
    return json({ error: e instanceof Error ? e.message : 'Analysis failed' }, { status: 500 });
  }
};
