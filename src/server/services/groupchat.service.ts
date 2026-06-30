/**
 * Group-chat orchestration — CRUD + the bg-runtime handler.
 *
 * A run is a set of ephemeral persona "subagents" that take round-robin turns
 * on one problem. Each turn is one server-side gateway `playground.complete`
 * call, so the whole conversation runs in the background (bg-runtime) and
 * survives navigation. An optional orchestrator turn summarizes + decides at
 * the end.
 */

import { and, asc, eq } from 'drizzle-orm';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { getCoreDb } from '$server/db/pg-client';
import {
  workshopGroupchatAgents,
  workshopGroupchatMessages,
  workshopGroupchatRuns,
} from '$server/db/pg-schema/workshop-experiments';
import { registerJobHandler, type AdvanceResult, type BgJob } from './bg-runtime';

export type GroupchatAgentInput = {
  name: string;
  systemPrompt: string;
  provider: string;
  modelId: string;
};

const STYLE_PREAMBLE: Record<string, string> = {
  debate:
    'This is a structured debate. Take a clear position, challenge the other participants’ arguments, and defend yours with concrete reasoning.',
  brainstorm:
    'This is a brainstorm. Build on the others’ ideas and diverge widely. Defer judgement — quantity and novelty over criticism.',
  critique:
    'Critique the previous contributions, name their weaknesses, and refine the group toward a stronger answer.',
  'red-team':
    'Red-team the emerging solution: hunt for flaws, edge cases, security holes, and failure modes the others missed.',
  freeform: 'Collaborate with the other participants to solve the problem.',
};

const INFINITE_SAFETY_TURNS = 40; // hard cap so "infinite" runs can't bill forever

export async function createGroupchatRun(input: {
  tenantId: string;
  userId?: string | null;
  serverId?: string | null;
  prompt: string;
  rounds: number | null;
  style: string;
  includeOrchestrator: boolean;
  background: boolean;
  agents: GroupchatAgentInput[];
}): Promise<string> {
  const db = getCoreDb();
  const runId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(workshopGroupchatRuns).values({
    id: runId,
    tenantId: input.tenantId,
    serverId: input.serverId ?? null,
    userId: input.userId ?? null,
    prompt: input.prompt,
    status: 'draft',
    rounds: input.rounds,
    style: input.style,
    includeOrchestrator: input.includeOrchestrator,
    background: input.background,
    currentRound: 0,
    createdAt: now,
    finishedAt: null,
  });
  if (input.agents.length > 0) {
    await db.insert(workshopGroupchatAgents).values(
      input.agents.map((a, i) => ({
        id: crypto.randomUUID(),
        runId,
        name: a.name,
        systemPrompt: a.systemPrompt,
        provider: a.provider,
        modelId: a.modelId,
        orderIndex: i,
      })),
    );
  }
  return runId;
}

export async function getGroupchatRun(tenantId: string, runId: string) {
  const db = getCoreDb();
  const [run] = await db
    .select()
    .from(workshopGroupchatRuns)
    .where(and(eq(workshopGroupchatRuns.id, runId), eq(workshopGroupchatRuns.tenantId, tenantId)))
    .limit(1);
  if (!run) return null;
  const agents = await db
    .select()
    .from(workshopGroupchatAgents)
    .where(eq(workshopGroupchatAgents.runId, runId))
    .orderBy(asc(workshopGroupchatAgents.orderIndex));
  const messages = await db
    .select()
    .from(workshopGroupchatMessages)
    .where(eq(workshopGroupchatMessages.runId, runId))
    .orderBy(asc(workshopGroupchatMessages.createdAt));
  return { run, agents, messages };
}

export async function setRunStatus(runId: string, status: string): Promise<void> {
  await getCoreDb()
    .update(workshopGroupchatRuns)
    .set({ status, ...(status === 'done' || status === 'cancelled' ? { finishedAt: Date.now() } : {}) })
    .where(eq(workshopGroupchatRuns.id, runId));
}

// ── bg-runtime handler ─────────────────────────────────────────────────────────

type GcMessage = typeof workshopGroupchatMessages.$inferSelect;
type GcAgent = typeof workshopGroupchatAgents.$inferSelect;

function transcriptAsMessages(
  prompt: string,
  msgs: GcMessage[],
  agents: GcAgent[],
): { role: 'user'; content: string }[] {
  const nameOf = (m: GcMessage) =>
    m.agentId ? (agents.find((a) => a.id === m.agentId)?.name ?? 'Agent') : 'Orchestrator';
  return [
    { role: 'user', content: `Problem to solve:\n${prompt}` },
    ...msgs.map((m) => ({ role: 'user' as const, content: `${nameOf(m)} said:\n${m.content}` })),
  ];
}

async function callModel(
  provider: string,
  modelId: string,
  system: string,
  messages: { role: 'user'; content: string }[],
): Promise<{ text: string; latencyMs?: number; tokens?: number; costUsd?: number }> {
  const res = await gatewayCall<{
    text: string;
    latencyMs?: number;
    usage?: { output?: number; cost?: { total?: number } };
  }>('playground.complete', { provider, modelId, system, messages }, { timeoutMs: 120_000 });
  return {
    text: res.text ?? '',
    latencyMs: res.latencyMs,
    tokens: res.usage?.output,
    costUsd: res.usage?.cost?.total,
  };
}

async function advanceGroupchat(job: BgJob): Promise<AdvanceResult> {
  const runId = job.refId;
  if (!runId) return { done: true };
  const db = getCoreDb();
  const ctx = await getGroupchatRun(job.tenantId, runId);
  if (!ctx) return { done: true };
  const { run, agents, messages } = ctx;
  if (run.status === 'cancelled') return { done: true };
  if (agents.length === 0) {
    await setRunStatus(runId, 'failed');
    return { done: true, error: 'no agents' };
  }
  if (run.status === 'draft' || run.status === 'queued') await setRunStatus(runId, 'running');

  const agentTurns = messages.filter((m) => m.agentId).length;
  const target =
    run.rounds != null ? run.rounds * agents.length : INFINITE_SAFETY_TURNS;
  const style = STYLE_PREAMBLE[run.style ?? 'freeform'] ?? STYLE_PREAMBLE.freeform;

  // All agent turns done → optional orchestrator turn, then finish.
  if (agentTurns >= target) {
    const hasOrchestrator = messages.some((m) => !m.agentId);
    if (run.includeOrchestrator && !hasOrchestrator) {
      const lead = agents[0];
      const system =
        'You are the orchestrator/decision-maker. Read the whole discussion, summarize the key points, and decide the single best approach to the problem. Be concise and concrete.';
      const out = await callModel(
        lead.provider,
        lead.modelId,
        system,
        transcriptAsMessages(run.prompt, messages, agents),
      );
      await db.insert(workshopGroupchatMessages).values({
        id: crypto.randomUUID(),
        runId,
        agentId: null,
        round: run.currentRound,
        role: 'orchestrator',
        content: out.text,
        modelId: lead.modelId,
        latencyMs: out.latencyMs ?? null,
        tokens: out.tokens ?? null,
        costUsd: out.costUsd ?? null,
        createdAt: Date.now(),
      });
    }
    await setRunStatus(runId, 'done');
    return { done: true };
  }

  // Next agent's turn.
  const agent = agents[agentTurns % agents.length];
  const round = Math.floor(agentTurns / agents.length) + 1;
  const system = `${style}\n\nYou are "${agent.name}". ${agent.systemPrompt}\n\nRespond in character with your contribution for this round. Be substantive but concise.`;
  const out = await callModel(
    agent.provider,
    agent.modelId,
    system,
    transcriptAsMessages(run.prompt, messages, agents),
  );
  await db.insert(workshopGroupchatMessages).values({
    id: crypto.randomUUID(),
    runId,
    agentId: agent.id,
    round,
    role: 'assistant',
    content: out.text,
    modelId: agent.modelId,
    latencyMs: out.latencyMs ?? null,
    tokens: out.tokens ?? null,
    costUsd: out.costUsd ?? null,
    createdAt: Date.now(),
  });
  await db
    .update(workshopGroupchatRuns)
    .set({ currentRound: round })
    .where(eq(workshopGroupchatRuns.id, runId));

  return { done: false };
}

registerJobHandler({ type: 'groupchat', advance: advanceGroupchat });
