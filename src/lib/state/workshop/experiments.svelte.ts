// Workshop experiments client state — model list + comparison orchestration.
//
// LLM calls go through the existing authenticated gateway WS (sendRequest), one
// playground.complete per selected model, fanned out in parallel. Results are
// then persisted to the hub DB via /api/workshop/* routes. This keeps provider
// keys on the gateway and DB writes server-side.

import { sendRequest } from '$lib/services/gateway-rpc';

export type ModelItem = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  enabled?: boolean;
};

export type ModelsListResult = {
  models: ModelItem[];
  defaultModel?: string;
  role?: 'admin' | 'user';
};

export type CompareOutput = {
  modelId: string;
  provider: string;
  name: string;
  status: 'pending' | 'done' | 'error';
  text: string;
  error?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

type Usage = {
  input?: number;
  output?: number;
  cost?: { total?: number };
};

/** Fetch the role-filtered model list from the gateway. */
export async function loadModels(): Promise<ModelsListResult> {
  const res = (await sendRequest('models.list', {})) as ModelsListResult;
  return { models: res.models ?? [], defaultModel: res.defaultModel, role: res.role };
}

/** Persist the admin-curated enabled-model set (no-op for non-admins → 403). */
export async function setEnabledModels(enabledModelIds: string[]): Promise<void> {
  await sendRequest('models.setEnabled', { enabledModelIds });
}

/**
 * Run one prompt against several models in parallel. Mutates the passed
 * `outputs` array in place (each entry flips pending → done/error) so the UI
 * can render streaming-style column updates, then returns the settled list.
 */
export async function runComparison(
  models: ModelItem[],
  prompt: string,
  system: string | undefined,
  params: { temperature?: number; maxTokens?: number } | undefined,
  outputs: CompareOutput[],
): Promise<void> {
  await Promise.all(
    models.map(async (model) => {
      const slot = outputs.find((o) => o.modelId === model.id);
      if (!slot) return;
      try {
        const res = (await sendRequest(
          'playground.complete',
          {
            provider: model.provider,
            modelId: model.id,
            messages: [{ role: 'user', content: prompt }],
            ...(system ? { system } : {}),
            ...(params ? { params } : {}),
          },
          180_000,
        )) as { text: string; latencyMs?: number; usage?: Usage };
        slot.status = 'done';
        slot.text = res.text ?? '';
        slot.latencyMs = res.latencyMs;
        slot.inputTokens = res.usage?.input;
        slot.outputTokens = res.usage?.output;
        slot.costUsd = res.usage?.cost?.total;
      } catch (err) {
        slot.status = 'error';
        slot.error = err instanceof Error ? err.message : String(err);
      }
    }),
  );
}

/** Persist a finished comparison run + its outputs. Returns the new run id. */
export async function saveComparison(payload: {
  prompt: string;
  system?: string;
  params?: unknown;
  blind: boolean;
  outputs: CompareOutput[];
}): Promise<string> {
  const res = await fetch('/api/workshop/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  const data = (await res.json()) as { runId: string };
  return data.runId;
}

/** Persist a ranking (ordered model ids, best first) + category tags. */
export async function submitRanking(
  runId: string,
  rankedModelIds: string[],
  categories: string[],
): Promise<void> {
  const res = await fetch('/api/workshop/compare/rank', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, rankedModelIds, categories }),
  });
  if (!res.ok) throw new Error(`rank failed: ${res.status}`);
}

// ── Group chat ─────────────────────────────────────────────────────────────────

export type Persona = { name: string; systemPrompt: string; provider: string; modelId: string };

export type GroupchatRun = {
  id: string;
  prompt: string;
  status: string;
  rounds: number | null;
  style: string | null;
  includeOrchestrator: number;
  currentRound: number;
};
export type GroupchatAgent = { id: string; name: string; modelId: string; orderIndex: number };
export type GroupchatMessage = {
  id: string;
  agentId: string | null;
  round: number;
  role: string;
  content: string;
  modelId: string | null;
  createdAt: number;
};
export type GroupchatCtx = {
  run: GroupchatRun;
  agents: GroupchatAgent[];
  messages: GroupchatMessage[];
};

/** Propose a panel of subagent personas for a problem (one model call). */
export async function suggestSubagents(
  model: ModelItem,
  prompt: string,
): Promise<{ name: string; systemPrompt: string }[]> {
  try {
    const res = (await sendRequest(
      'playground.complete',
      {
        provider: model.provider,
        modelId: model.id,
        system:
          'You assemble a small panel of expert subagents to collaborate on a problem. Propose 3-4 DISTINCT personas with complementary perspectives. Reply with ONLY a JSON array of objects {"name","systemPrompt"} where systemPrompt is a 1-2 sentence role description. No prose, no code fences.',
        messages: [{ role: 'user', content: prompt }],
        params: { maxTokens: 600, temperature: 0.7 },
      },
      60_000,
    )) as { text: string };
    const raw = (res.text ?? '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw) as { name?: string; systemPrompt?: string }[];
    return parsed
      .filter((p) => p.name && p.systemPrompt)
      .map((p) => ({ name: p.name!, systemPrompt: p.systemPrompt! }))
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function createGroupchat(payload: {
  prompt: string;
  rounds: number | null;
  style: string;
  includeOrchestrator: boolean;
  background: boolean;
  agents: Persona[];
}): Promise<string> {
  const res = await fetch('/api/workshop/groupchat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  return ((await res.json()) as { runId: string }).runId;
}

export async function getGroupchat(runId: string): Promise<GroupchatCtx> {
  const res = await fetch(`/api/workshop/groupchat/${runId}`);
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  return (await res.json()) as GroupchatCtx;
}

/** Nudge the server to advance this run a step (snappy while the page is open). */
export async function advanceGroupchat(runId: string): Promise<void> {
  await fetch(`/api/workshop/groupchat/${runId}/advance`, { method: 'POST' }).catch(() => {});
}

export async function cancelGroupchat(runId: string): Promise<void> {
  await fetch(`/api/workshop/groupchat/${runId}/cancel`, { method: 'POST' }).catch(() => {});
}

/** Suggest category tags for a prompt via one cheap model call. */
export async function suggestCategories(
  model: ModelItem,
  prompt: string,
): Promise<string[]> {
  try {
    const res = (await sendRequest(
      'playground.complete',
      {
        provider: model.provider,
        modelId: model.id,
        system:
          'You label prompts with 1-3 short lowercase topic tags (e.g. "coding", "creative writing", "summarization"). Reply with ONLY a comma-separated list, no prose.',
        messages: [{ role: 'user', content: prompt }],
        params: { maxTokens: 40, temperature: 0 },
      },
      30_000,
    )) as { text: string };
    return (res.text ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.length <= 40)
      .slice(0, 3);
  } catch {
    return [];
  }
}
