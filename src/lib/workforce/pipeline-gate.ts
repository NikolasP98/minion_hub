import type { PipelineTrace, PipelineTraceStage } from './pipeline-trace';

const ACTIVE_STAGE_TASK_STATUSES = new Set(['todo', 'in_progress', 'in_review']);
const TERMINAL_EVENT_TYPES = new Set(['stage_completed', 'stage_failed']);

export type PipelineGateIssue = {
  id: string;
  status: string;
  originKind?: string | null;
  originId?: string | null;
  assigneeUserId?: string | null;
  executionState?: {
    status?: string | null;
    currentParticipant?: { type?: string | null } | null;
  } | null;
};

export type PipelineGate = {
  stage: PipelineTraceStage;
  retryStepKey: string | null;
  permitsEvalScore: boolean;
};

export type PipelineGateDecision = 'approve' | 'request_changes';

export type PipelineGateMutation = {
  status: 'done';
  pipelineOutcome: 'passed' | 'failed';
  pipelineSummary: string;
  evalScore?: number;
  feedbackScore?: number;
};

export type InlinePipelineGateMutation = {
  status: 'done' | 'in_progress';
  comment: string;
  feedbackScore?: number;
};

export type PipelineGateValidationError =
  | 'summary_required'
  | 'summary_too_long'
  | 'retry_unavailable'
  | 'score_contract_missing'
  | 'score_required'
  | 'score_invalid'
  | 'score_below_threshold';

export type PipelineGateMutationResult =
  { ok: true; payload: PipelineGateMutation } | { ok: false; error: PipelineGateValidationError };

export type InlinePipelineGateMutationResult =
  | { ok: true; payload: InlinePipelineGateMutation }
  | { ok: false; error: PipelineGateValidationError };

/** Compatibility gate for the older inline executionPolicy protocol. */
export function hasActiveInlinePipelineGate(issue: PipelineGateIssue): boolean {
  return (
    issue.originKind !== 'pipeline_step' &&
    issue.status === 'in_review' &&
    issue.executionState?.status === 'pending' &&
    issue.executionState.currentParticipant?.type === 'user'
  );
}

/** Preserve the legacy inline mutation contract; it is not a stage-task traversal. */
export function buildInlinePipelineGateMutation(input: {
  decision: PipelineGateDecision;
  comment: string;
  feedbackScore?: number;
}): InlinePipelineGateMutationResult {
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: 'summary_required' };
  if (comment.length > 4_000) return { ok: false, error: 'summary_too_long' };
  if (
    input.feedbackScore !== undefined &&
    (!Number.isFinite(input.feedbackScore) || input.feedbackScore < 0 || input.feedbackScore > 10)
  ) {
    return { ok: false, error: 'score_invalid' };
  }
  return {
    ok: true,
    payload: {
      status: input.decision === 'approve' ? 'done' : 'in_progress',
      comment,
      ...(input.feedbackScore === undefined ? {} : { feedbackScore: input.feedbackScore }),
    },
  };
}

/**
 * Resolve a live, user-owned stage-task gate from immutable run evidence.
 * Returning null hides controls for stale attempts, agent stages, and main issues.
 */
export function activePipelineGate(
  issue: PipelineGateIssue,
  trace: PipelineTrace | null,
  viewerUserId: string | null,
): PipelineGate | null {
  if (
    !trace ||
    trace.status !== 'active' ||
    !trace.currentStepKey ||
    !trace.currentStage ||
    trace.currentStage.key !== trace.currentStepKey ||
    (trace.currentStage.kind !== 'approval' && trace.currentStage.kind !== 'eval') ||
    trace.currentStage.participantType !== 'user' ||
    issue.originKind !== 'pipeline_step' ||
    !issue.originId ||
    issue.originId !== trace.id ||
    !ACTIVE_STAGE_TASK_STATUSES.has(issue.status) ||
    !issue.assigneeUserId ||
    !viewerUserId ||
    issue.assigneeUserId !== viewerUserId ||
    trace.currentStage.participantUserId !== issue.assigneeUserId
  ) {
    return null;
  }

  const latestStageEvent = [...trace.events]
    .reverse()
    .find((event) => event.stepKey === trace.currentStepKey && event.childIssueId !== null);
  if (
    !latestStageEvent ||
    latestStageEvent.childIssueId !== issue.id ||
    TERMINAL_EVENT_TYPES.has(latestStageEvent.eventType)
  ) {
    return null;
  }

  return {
    stage: trace.currentStage,
    retryStepKey: trace.currentStage.onFailStepKey,
    permitsEvalScore: trace.currentStage.kind === 'eval',
  };
}

/** Build the only mutation shape that may close a HITL pipeline child. */
export function buildPipelineGateMutation(input: {
  gate: PipelineGate;
  decision: PipelineGateDecision;
  summary: string;
  evalScore?: number;
  feedbackScore?: number;
}): PipelineGateMutationResult {
  const summary = input.summary.trim();
  if (!summary) return { ok: false, error: 'summary_required' };
  if (summary.length > 4_000) return { ok: false, error: 'summary_too_long' };
  if (input.decision === 'request_changes' && !input.gate.retryStepKey) {
    return { ok: false, error: 'retry_unavailable' };
  }

  let evalScore: number | undefined;
  let feedbackScore: number | undefined;
  if (input.gate.permitsEvalScore) {
    const { minScore, maxScore } = input.gate.stage;
    if (
      minScore === null ||
      maxScore === null ||
      !Number.isFinite(minScore) ||
      !Number.isFinite(maxScore)
    ) {
      return { ok: false, error: 'score_contract_missing' };
    }
    if (input.evalScore === undefined) return { ok: false, error: 'score_required' };
    if (!Number.isFinite(input.evalScore) || input.evalScore < 0 || input.evalScore > maxScore) {
      return { ok: false, error: 'score_invalid' };
    }
    if (input.decision === 'approve' && input.evalScore < minScore) {
      return { ok: false, error: 'score_below_threshold' };
    }
    evalScore = input.evalScore;
  } else if (input.feedbackScore !== undefined) {
    if (
      !Number.isFinite(input.feedbackScore) ||
      input.feedbackScore < 0 ||
      input.feedbackScore > 10
    ) {
      return { ok: false, error: 'score_invalid' };
    }
    feedbackScore = input.feedbackScore;
  }

  return {
    ok: true,
    payload: {
      status: 'done',
      pipelineOutcome: input.decision === 'approve' ? 'passed' : 'failed',
      pipelineSummary: summary,
      ...(evalScore === undefined ? {} : { evalScore }),
      ...(feedbackScore === undefined ? {} : { feedbackScore }),
    },
  };
}
