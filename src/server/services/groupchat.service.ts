/**
 * Group-chat orchestration — CRUD + the bg-runtime handler.
 *
 * A run is a set of ephemeral persona "subagents" that take round-robin turns
 * on one problem. Each turn is one server-side gateway `playground.complete`
 * call, so the whole conversation runs in the background (bg-runtime) and
 * survives navigation. An optional orchestrator turn summarizes + decides at
 * the end.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { getCoreDb } from '$server/db/pg-client';
import {
  workshopGroupchatAgents,
  workshopGroupchatMessages,
  workshopGroupchatRuns,
} from '$server/db/pg-schema/workshop-experiments';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import {
  registerJobHandler,
  type AdvanceResult,
  type BgJob,
  type JobExecution,
  type JobTransaction,
} from './bg-runtime';

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
    .set({
      status,
      ...(status === 'done' || status === 'cancelled' ? { finishedAt: Date.now() } : {}),
    })
    .where(
      and(
        eq(workshopGroupchatRuns.id, runId),
        status === 'cancelled'
          ? inArray(workshopGroupchatRuns.status, ['draft', 'queued', 'running', 'paused'])
          : undefined,
      ),
    );
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

type EffectCheckpoint = {
  version: 1;
  key: string;
  ownerJobId: string;
  ownerGeneration: number;
  configHash: string;
  payloadHash: string;
  state: 'admitted' | 'committed';
};
const INDETERMINATE = 'groupchat effect outcome indeterminate; reconciliation required';
const CONFLICT = 'groupchat effect configuration changed; reconciliation required';
const FINALIZATION_FAILED =
  'groupchat terminal finalization failed; retry may resume committed effect';
class GroupchatFinalizationError extends Error {
  constructor() {
    super(FINALIZATION_FAILED);
  }
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function readSettings(raw: string | null): Record<string, unknown> {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(CONFLICT);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(CONFLICT);
  return value as Record<string, unknown>;
}
function readCheckpoint(settings: Record<string, unknown>): EffectCheckpoint | undefined {
  const value = settings.__jobEffect;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error(CONFLICT);
  const checkpoint = value as Partial<EffectCheckpoint>;
  if (
    checkpoint.version !== 1 ||
    typeof checkpoint.key !== 'string' ||
    typeof checkpoint.ownerJobId !== 'string' ||
    !Number.isInteger(checkpoint.ownerGeneration) ||
    (checkpoint.ownerGeneration ?? 0) < 1 ||
    typeof checkpoint.configHash !== 'string' ||
    typeof checkpoint.payloadHash !== 'string' ||
    !['admitted', 'committed'].includes(checkpoint.state ?? '')
  )
    throw new Error(CONFLICT);
  return checkpoint as EffectCheckpoint;
}
function configuration(run: typeof workshopGroupchatRuns.$inferSelect, agents: GcAgent[]) {
  return hash([run.prompt, run.rounds, run.style, run.includeOrchestrator, agents]);
}

async function finishCancelledJob(tx: JobTransaction, job: BgJob) {
  const now = Date.now();
  await tx
    .update(bgJobs)
    .set({
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
      leaseUntil: null,
      leaseGeneration: sql`${bgJobs.leaseGeneration} + 1`,
    })
    .where(and(eq(bgJobs.id, job.id), eq(bgJobs.tenantId, job.tenantId)));
}

async function finishRunJob(
  tx: JobTransaction,
  job: BgJob,
  status: 'done' | 'failed',
  error?: string,
) {
  const now = Date.now();
  await tx
    .update(bgJobs)
    .set({ status, error: error ?? null, leaseUntil: null, finishedAt: now, updatedAt: now })
    .where(and(eq(bgJobs.id, job.id), eq(bgJobs.tenantId, job.tenantId)));
}

async function advanceGroupchatStep(job: BgJob, execution: JobExecution): Promise<AdvanceResult> {
  const runId = job.refId;
  if (!runId) return { done: true };
  // settings.__jobEffect is server-owned. Existing public creation accepts no
  // settings, and the only public update is cancellation. Preserve other keys.
  let finalizingCommittedEffect = false;
  const admitted = await execution
    .withOwnership(async (tx) => {
      const [run] = await tx
        .select()
        .from(workshopGroupchatRuns)
        .where(
          and(
            eq(workshopGroupchatRuns.id, runId),
            eq(workshopGroupchatRuns.tenantId, job.tenantId),
          ),
        )
        .for('update');
      if (!run) return { result: { done: true } };
      if (run.status === 'cancelled') {
        await finishCancelledJob(tx, job);
        return { result: { done: true } };
      }
      const settings = readSettings(run.settings);
      const previous = readCheckpoint(settings);
      const agents = await tx
        .select()
        .from(workshopGroupchatAgents)
        .where(eq(workshopGroupchatAgents.runId, runId))
        .orderBy(asc(workshopGroupchatAgents.orderIndex));
      const configHash = configuration(run, agents);
      if (previous && previous.configHash !== configHash) throw new Error(CONFLICT);
      // An admitted call may have reached the provider even if no output arrived.
      // Neither a replacement owner nor a duplicate job may automatically repeat it.
      if (previous?.state === 'admitted') {
        // Only the original job's reclaim path may finalize that run. A duplicate
        // job must not infer another owner's failure or acquire its lock here.
        if (previous.ownerJobId === job.id) {
          await tx
            .update(workshopGroupchatRuns)
            .set({ status: 'failed', finishedAt: Date.now() })
            .where(
              and(
                eq(workshopGroupchatRuns.id, runId),
                eq(workshopGroupchatRuns.tenantId, job.tenantId),
              ),
            );
          await finishRunJob(tx, job, 'failed', INDETERMINATE);
        }
        return { result: { done: true, error: INDETERMINATE } };
      }
      const resumesFinalization =
        previous?.state === 'committed' &&
        previous.ownerJobId === job.id &&
        job.error === FINALIZATION_FAILED;
      if (run.status === 'done' || (run.status === 'failed' && !resumesFinalization))
        return { result: { done: true } };
      if (agents.length === 0) {
        await tx
          .update(workshopGroupchatRuns)
          .set({ status: 'failed' })
          .where(
            and(
              eq(workshopGroupchatRuns.id, runId),
              eq(workshopGroupchatRuns.tenantId, job.tenantId),
            ),
          );
        await finishRunJob(tx, job, 'failed', 'no agents');
        return { result: { done: true, error: 'no agents' } };
      }
      const messages = await tx
        .select()
        .from(workshopGroupchatMessages)
        .where(eq(workshopGroupchatMessages.runId, runId))
        .orderBy(asc(workshopGroupchatMessages.createdAt), asc(workshopGroupchatMessages.id));
      if (previous && !messages.some((message) => message.id === previous.key))
        throw new Error(CONFLICT);
      const agentTurns = messages.filter((message) => message.agentId).length;
      const target = run.rounds != null ? run.rounds * agents.length : INFINITE_SAFETY_TURNS;
      const orchestrator = agentTurns >= target;
      if (
        orchestrator &&
        (!run.includeOrchestrator || messages.some((message) => !message.agentId))
      ) {
        finalizingCommittedEffect = true;
        await tx
          .update(workshopGroupchatRuns)
          .set({ status: 'done', finishedAt: Date.now() })
          .where(
            and(
              eq(workshopGroupchatRuns.id, runId),
              eq(workshopGroupchatRuns.tenantId, job.tenantId),
            ),
          );
        await finishRunJob(tx, job, 'done');
        return { result: { done: true } };
      }
      const agent = agents[orchestrator ? 0 : agentTurns % agents.length];
      const round = orchestrator ? run.currentRound : Math.floor(agentTurns / agents.length) + 1;
      const style = STYLE_PREAMBLE[run.style ?? 'freeform'] ?? STYLE_PREAMBLE.freeform;
      const system = orchestrator
        ? 'You are the orchestrator/decision-maker. Read the whole discussion, summarize the key points, and decide the single best approach to the problem. Be concise and concrete.'
        : `${style}\n\nYou are "${agent.name}". ${agent.systemPrompt}\n\nRespond in character with your contribution for this round. Be substantive but concise.`;
      const transcript = transcriptAsMessages(run.prompt, messages, agents);
      const checkpoint: EffectCheckpoint = {
        version: 1,
        key: execution.effectKey(orchestrator ? 'orchestrator' : `agent:${agentTurns}`, runId),
        ownerJobId: job.id,
        ownerGeneration: execution.leaseGeneration,
        configHash,
        payloadHash: hash([agent.provider, agent.modelId, system, transcript]),
        state: 'admitted',
      };
      await tx
        .update(workshopGroupchatRuns)
        .set({
          status: 'running',
          settings: JSON.stringify({ ...settings, __jobEffect: checkpoint }),
        })
        .where(
          and(
            eq(workshopGroupchatRuns.id, runId),
            eq(workshopGroupchatRuns.tenantId, job.tenantId),
          ),
        );
      await tx
        .update(bgJobs)
        .set({ cursor: JSON.stringify(checkpoint) })
        .where(and(eq(bgJobs.id, job.id), eq(bgJobs.tenantId, job.tenantId)));
      return { effect: { checkpoint, agent, round, orchestrator, system, transcript } };
    })
    .catch((error: unknown) => {
      if (finalizingCommittedEffect) throw new GroupchatFinalizationError();
      throw error;
    });
  if (admitted.result) return admitted.result;
  const { checkpoint, agent, round, orchestrator, system, transcript } = admitted.effect!;
  // Admission is the linearization point. The gateway has no cancellation or
  // idempotency receipt; cancellation cannot revoke an already admitted RPC.
  // TODO(handoff): Reconcile admitted remote outcomes using provider receipts before offering retry; no automatic repeat is safe. See meta proposals/2026-09-08-platform-qc-remediation.md (HDS-05).
  execution.signal.throwIfAborted();
  let output: Awaited<ReturnType<typeof callModel>>;
  try {
    output = await callModel(agent.provider, agent.modelId, system, transcript);
  } catch {
    // Do not expose unsanitized gateway errors or pretend a timeout means no call.
    return execution.withOwnership(async (tx) => {
      const [run] = await tx
        .select()
        .from(workshopGroupchatRuns)
        .where(
          and(
            eq(workshopGroupchatRuns.id, runId),
            eq(workshopGroupchatRuns.tenantId, job.tenantId),
          ),
        )
        .for('update');
      if (run?.status === 'cancelled') {
        await finishCancelledJob(tx, job);
        return { done: true };
      }
      if (run && readCheckpoint(readSettings(run.settings))?.key === checkpoint.key) {
        await tx
          .update(workshopGroupchatRuns)
          .set({ status: 'failed', finishedAt: Date.now() })
          .where(
            and(
              eq(workshopGroupchatRuns.id, runId),
              eq(workshopGroupchatRuns.tenantId, job.tenantId),
            ),
          );
      }
      await finishRunJob(tx, job, 'failed', INDETERMINATE);
      return { done: true, error: INDETERMINATE };
    });
  }
  return execution.withOwnership(async (tx) => {
    const [run] = await tx
      .select()
      .from(workshopGroupchatRuns)
      .where(
        and(eq(workshopGroupchatRuns.id, runId), eq(workshopGroupchatRuns.tenantId, job.tenantId)),
      )
      .for('update');
    if (!run) return { done: true };
    if (run.status === 'cancelled') {
      await finishCancelledJob(tx, job);
      return { done: true };
    }
    const settings = readSettings(run.settings);
    const current = readCheckpoint(settings);
    const agents = await tx
      .select()
      .from(workshopGroupchatAgents)
      .where(eq(workshopGroupchatAgents.runId, runId))
      .orderBy(asc(workshopGroupchatAgents.orderIndex));
    if (
      !current ||
      current.key !== checkpoint.key ||
      current.ownerJobId !== job.id ||
      current.ownerGeneration !== execution.leaseGeneration ||
      current.payloadHash !== checkpoint.payloadHash ||
      configuration(run, agents) !== checkpoint.configHash
    )
      throw new Error(CONFLICT);
    const messages = await tx
      .select()
      .from(workshopGroupchatMessages)
      .where(eq(workshopGroupchatMessages.runId, runId))
      .orderBy(asc(workshopGroupchatMessages.createdAt), asc(workshopGroupchatMessages.id));
    const currentTranscript = transcriptAsMessages(
      run.prompt,
      messages.filter((message) => message.id !== checkpoint.key),
      agents,
    );
    if (hash([agent.provider, agent.modelId, system, currentTranscript]) !== checkpoint.payloadHash)
      throw new Error(CONFLICT);
    if (current.state !== 'committed') {
      await tx.insert(workshopGroupchatMessages).values({
        id: checkpoint.key,
        runId,
        agentId: orchestrator ? null : agent.id,
        round,
        role: orchestrator ? 'orchestrator' : 'assistant',
        content: output.text,
        modelId: agent.modelId,
        latencyMs: output.latencyMs ?? null,
        tokens: output.tokens ?? null,
        costUsd: output.costUsd ?? null,
        createdAt: Date.now(),
      });
    }
    const committed: EffectCheckpoint = { ...checkpoint, state: 'committed' };
    await tx
      .update(workshopGroupchatRuns)
      .set({
        currentRound: round,
        ...(orchestrator ? { status: 'done', finishedAt: Date.now() } : {}),
        settings: JSON.stringify({ ...settings, __jobEffect: committed }),
      })
      .where(
        and(eq(workshopGroupchatRuns.id, runId), eq(workshopGroupchatRuns.tenantId, job.tenantId)),
      );
    await tx
      .update(bgJobs)
      .set({ cursor: JSON.stringify(committed) })
      .where(and(eq(bgJobs.id, job.id), eq(bgJobs.tenantId, job.tenantId)));
    if (orchestrator) await finishRunJob(tx, job, 'done');
    return { done: orchestrator, cursor: committed };
  });
}

async function advanceGroupchat(job: BgJob, execution: JobExecution): Promise<AdvanceResult> {
  try {
    return await advanceGroupchatStep(job, execution);
  } catch (error) {
    const finalizationFailed = error instanceof GroupchatFinalizationError;
    if (
      !(error instanceof Error) ||
      (!finalizationFailed && error.message !== CONFLICT) ||
      !job.refId
    )
      throw error;
    const message = finalizationFailed ? FINALIZATION_FAILED : CONFLICT;
    return execution.withOwnership(async (tx) => {
      const [run] = await tx
        .select()
        .from(workshopGroupchatRuns)
        .where(
          and(
            eq(workshopGroupchatRuns.id, job.refId!),
            eq(workshopGroupchatRuns.tenantId, job.tenantId),
          ),
        )
        .for('update');
      if (run?.status === 'cancelled') {
        await finishCancelledJob(tx, job);
        return { done: true };
      }
      let mayFinalizeRun = false;
      if (run) {
        try {
          const checkpoint = readCheckpoint(readSettings(run.settings));
          mayFinalizeRun = finalizationFailed
            ? checkpoint?.ownerJobId === job.id && checkpoint.state === 'committed'
            : !checkpoint || checkpoint.ownerJobId === job.id;
        } catch {
          // Unreadable ownership metadata cannot authorize changing another run owner.
          // TODO(handoff): Reconcile unreadable checkpoints and storage-unavailable terminal writes through an explicit recovery path; no owner inference or automatic RPC replay. See meta proposals/2026-09-08-platform-qc-remediation.md (HDS-05).
          mayFinalizeRun = false;
        }
      }
      if (run && mayFinalizeRun && ['draft', 'queued', 'running', 'paused'].includes(run.status)) {
        await tx
          .update(workshopGroupchatRuns)
          .set({ status: 'failed', finishedAt: Date.now() })
          .where(
            and(
              eq(workshopGroupchatRuns.id, run.id),
              eq(workshopGroupchatRuns.tenantId, job.tenantId),
            ),
          );
      }
      await finishRunJob(tx, job, 'failed', message);
      return { done: true, error: message };
    });
  }
}

registerJobHandler({ type: 'groupchat', advance: advanceGroupchat });
