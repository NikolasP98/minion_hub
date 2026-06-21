import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getSystemAgentDescriptors } from '$lib/server/system-agents/registry';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { flowVariableSchema } from '$lib/flows/flow-variables';
import { listExportToggles } from '$lib/server/flows/exports-store';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';
import { buildBuilderPrompt, buildRegeneratePrompt, buildRepairPrompt, extractHtml, validateBundle } from './builder-prompt';
import { getArtifactRow } from './store';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_ATTEMPTS = 3;

export type BuildProgress = { phase: 'generating' | 'repairing'; attempt: number; max: number };
export type OnProgress = (p: BuildProgress) => void;

async function runBuildLoop(apiKey: string, basePrompt: string, onProgress?: OnProgress): Promise<string> {
  const BUILDER_MODEL = env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const attempt = async (p: string): Promise<string> => {
    const res = await generateText({ model: openrouter(BUILDER_MODEL), prompt: p, temperature: 0.3 });
    return extractHtml(res.text);
  };

  let current = basePrompt;
  let last = '';
  let lastErr: Error | null = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    onProgress?.({ phase: lastErr ? 'repairing' : 'generating', attempt: i + 1, max: MAX_ATTEMPTS });
    last = await attempt(current);
    try {
      validateBundle(last);
      return last;
    } catch (e) {
      lastErr = e as Error;
      current = buildRepairPrompt(basePrompt, last, lastErr.message);
    }
  }
  throw lastErr ?? new Error('artifact generation failed');
}

export async function generateArtifactHtml(
  ctx: CoreCtx,
  args: { agentId: string; prompt: string },
  onProgress?: OnProgress,
): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('artifact builder unavailable: OPENROUTER_API_KEY not set');

  const desc = getSystemAgentDescriptors().find((d) => d.id === args.agentId);
  if (!desc?.flowId) throw new Error('unknown agent or agent has no flow');

  const flow = getMasterFlow(desc.flowId);
  const specs = flow ? flowExportedSpecs(flow) : [];
  const toggles = await listExportToggles(ctx, desc.flowId).catch(() => ({}));
  const schema = flowVariableSchema(specs, toggles);

  const prompt = buildBuilderPrompt({
    agent: { name: desc.name, role: desc.role, trigger: desc.trigger },
    schema,
    userPrompt: args.prompt,
    reference: overviewHtml,
  });

  return runBuildLoop(apiKey, prompt, onProgress);
}

export async function regenerateArtifactHtml(
  ctx: CoreCtx,
  args: { artifactId: string; refinement: string },
  onProgress?: OnProgress,
): Promise<{ html: string; agentId: string }> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('artifact builder unavailable: OPENROUTER_API_KEY not set');
  const row = await getArtifactRow(ctx, args.artifactId);
  if (!row) throw new Error('artifact not found');
  const desc = getSystemAgentDescriptors().find((d) => d.id === row.agentId);
  const flow = desc?.flowId ? getMasterFlow(desc.flowId) : undefined;
  const specs = flow ? flowExportedSpecs(flow) : [];
  const toggles = desc?.flowId ? await listExportToggles(ctx, desc.flowId).catch(() => ({})) : {};
  const schema = flowVariableSchema(specs, toggles);
  const base = buildRegeneratePrompt({
    agent: { name: desc?.name ?? row.agentId, role: desc?.role ?? '', trigger: desc?.trigger ?? '' },
    schema, currentHtml: row.html, refinement: args.refinement, reference: overviewHtml,
  });
  const html = await runBuildLoop(apiKey, base, onProgress);
  return { html, agentId: row.agentId };
}
