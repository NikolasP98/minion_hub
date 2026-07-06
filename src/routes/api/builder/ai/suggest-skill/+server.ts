import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { getToolInfo } from '$lib/data/tool-manifest';
import { getOpenRouterModel, estimateCost } from '$server/llm';

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

const chapterSchema = z.object({
  type: z.enum(['chapter', 'condition']),
  name: z.string().describe('Unique chapter name'),
  description: z.string().optional(),
  guide: z.string().optional().describe('Imperative instructions (verb-first bullet points)'),
  toolIds: z.array(z.string()).optional(),
  context: z.string().optional().describe('What data this chapter receives from upstream'),
  outputDef: z.string().optional().describe('What data this chapter produces'),
  conditionText: z.string().optional().describe('Binary yes/no question (condition nodes only)'),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

const edgeSchema = z.object({
  fromName: z.string().describe('Name of the source chapter'),
  toName: z.string().describe('Name of the target chapter'),
  label: z
    .enum(['Yes', 'No'])
    .nullable()
    .optional()
    .describe('Branch label for condition edges (Yes/No for condition nodes, null for regular edges)'),
});

const skillPipelineSchema = z.object({
  chapters: z.array(chapterSchema),
  edges: z.array(edgeSchema),
});

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
  }

  const body = await request.json();
  const { name, description, availableToolIds, model, currentGraph, previewOnly } = body;
  if (!description?.trim()) throw error(400, 'Skill description is required');

  const toolDescriptions = (availableToolIds ?? [])
    .map((id: string) => {
      const info = getToolInfo(id);
      return `- ${info.id}: ${info.description}`;
    })
    .join('\n');

  // Build currentGraph context if chapters already exist (AI-05: incremental generation)
  let graphContext = '';
  if (currentGraph?.chapters?.length) {
    const chapterList = currentGraph.chapters
      .map(
        (c: { name: string; description?: string }) =>
          `- "${c.name}": ${c.description || '(no description)'}`,
      )
      .join('\n');
    const edgeList = currentGraph.edges?.length
      ? currentGraph.edges
          .map(
            (e: { sourceChapterId: string; targetChapterId: string }) =>
              `- ${e.sourceChapterId} -> ${e.targetChapterId}`,
          )
          .join('\n')
      : '(none)';
    graphContext = `\nEXISTING CHAPTERS (do NOT duplicate these — generate only NEW chapters that complement the pipeline):\n${chapterList}\n\nEXISTING EDGES:\n${edgeList}\n\nGenerate ADDITIONAL chapters that extend or complement this existing pipeline. Do not duplicate any existing chapter names. Connect new chapters to existing ones where logical.\n`;
  }

  const userPrompt = `${graphContext}Skill: <skill_name>${name || 'Untitled Skill'}</skill_name>
Description: <skill_description>${description}</skill_description>

Available tools:
${toolDescriptions || '(none)'}

Design a complete chapter pipeline for this skill. Include condition nodes where branching logic is needed. Each chapter must use only tools from the available list.`;

  try {
    const { object, usage } = await generateObject({
      model: getOpenRouterModel(model || DEFAULT_MODEL),
      schema: skillPipelineSchema,
      maxOutputTokens: previewOnly ? 512 : 2048,
      system:
        SYSTEM_PROMPT +
        (previewOnly
          ? '\n\nIMPORTANT: Return ONLY chapter names and brief one-line descriptions. Do not generate guide, context, outputDef, or toolIds content — leave them empty.'
          : ''),
      prompt: userPrompt,
      headers: { 'HTTP-Referer': hubBaseUrl(), 'X-Title': 'Minion Hub Builder' },
    });

    const chapters = object.chapters as Array<{ name: string; [k: string]: unknown }>;

    // CFIX-03: Filter tool IDs against available pool
    const availableSet = new Set<string>(availableToolIds ?? []);
    const filteredToolIds: string[] = [];

    for (const ch of chapters) {
      if (ch.toolIds && Array.isArray(ch.toolIds)) {
        const before = ch.toolIds as string[];
        const removed = before.filter((id: string) => !availableSet.has(id));
        filteredToolIds.push(...removed);
        (ch as Record<string, unknown>).toolIds = before.filter((id: string) =>
          availableSet.has(id),
        );
      }
    }

    const warning =
      filteredToolIds.length > 0
        ? `${filteredToolIds.length} tool(s) not available in current pool were removed: ${filteredToolIds.join(', ')}`
        : undefined;

    // Resolve name-based edges to index-based for frontend compatibility. The
    // schema enforces fromName/toName as strings, so the legacy index-based
    // edge fallback (for models that skipped structured output) is dead code
    // now that generateObject guarantees the shape — dropped.
    const edges = object.edges
      .map((e) => ({
        from: chapters.findIndex((ch) => ch.name === e.fromName),
        to: chapters.findIndex((ch) => ch.name === e.toName),
        label: e.label ?? null,
      }))
      .filter((e) => e.from >= 0 && e.to >= 0);

    // CFIX-10: Extract usage and estimate cost
    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    const usedModel = model || DEFAULT_MODEL;

    // previewOnly: return only chapter titles for ghost suggestions (AI-02)
    if (previewOnly) {
      return json({
        chapters: chapters.map((ch) => ({
          name: ch.name,
          description: (ch as Record<string, unknown>).description ?? '',
        })),
        previewOnly: true,
        usage: {
          promptTokens,
          completionTokens,
          estimatedCost: estimateCost(usedModel, promptTokens, completionTokens),
        },
      });
    }

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
    return json(
      {
        error: e instanceof Error ? e.message : 'AI suggestion failed',
      },
      { status: 500 },
    );
  }
};
