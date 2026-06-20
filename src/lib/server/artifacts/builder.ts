import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getSystemAgentDescriptors } from '$lib/server/system-agents/registry';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { flowVariableSchema } from '$lib/flows/flow-variables';
import { listExportToggles } from '$lib/server/flows/exports-store';
import overviewHtml from '$lib/artifacts/builtin/overview/index.html?raw';
import { buildBuilderPrompt, extractHtml, validateBundle } from './builder-prompt';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export async function generateArtifactHtml(
  ctx: CoreCtx,
  args: { agentId: string; prompt: string },
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

  const BUILDER_MODEL = env.ARTIFACT_BUILDER_MODEL || 'anthropic/claude-3.7-sonnet';
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const res = await generateText({ model: openrouter(BUILDER_MODEL), prompt, temperature: 0.3 });
  const html = extractHtml(res.text);
  validateBundle(html);
  return html;
}
