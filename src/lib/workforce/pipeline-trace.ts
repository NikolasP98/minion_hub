export type PipelineTraceCategory =
  'classifier' | 'routing' | 'handoff' | 'retry' | 'hitl' | 'merge' | 'stage' | 'lifecycle';

export type PipelineTraceEventStatus =
  'queued' | 'in_progress' | 'done' | 'blocked' | 'failed' | 'cancelled' | 'event';

export type PipelineTraceEvent = {
  id: string;
  sequence: number;
  eventType: string;
  category: PipelineTraceCategory;
  status: PipelineTraceEventStatus;
  stepKey: string | null;
  stageLabel: string | null;
  stageKind: string | null;
  attempt: number | null;
  childIssueId: string | null;
  score: number | null;
  maxScore: number | null;
  resolvedAdapterType: string | null;
  resolvedModel: string | null;
  resolvedProvider: string | null;
  harnessRevisionId: string | null;
  participantType: string | null;
  outcome: 'passed' | 'failed' | null;
  summary: string | null;
  occurredAt: string | null;
};

export type PipelineTraceStage = {
  key: string;
  label: string;
  kind: string;
  participantType: string | null;
  participantUserId: string | null;
  onFailStepKey: string | null;
  minScore: number | null;
  maxScore: number | null;
  rubric: string | null;
};

export type PipelineTrace = {
  id: string;
  status: string;
  currentStepKey: string | null;
  currentStage: PipelineTraceStage | null;
  sourceOriginKind: string | null;
  sourceOriginId: string | null;
  pipelineName: string | null;
  selectedPortfolioId: string | null;
  selectedProjectId: string | null;
  repository: string | null;
  resolution: string | null;
  confidence: number | null;
  reason: string | null;
  originalLabels: string[];
  inferredLabels: string[];
  startedAt: string | null;
  completedAt: string | null;
  events: PipelineTraceEvent[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pipelineOutcome(value: unknown): 'passed' | 'failed' | null {
  return value === 'passed' || value === 'failed' ? value : null;
}

function traceStage(stage: Record<string, unknown> | null): PipelineTraceStage | null {
  const key = text(stage?.key ?? stage?.id);
  const label = text(stage?.label);
  const kind = text(stage?.kind);
  if (!stage || !key || !label || !kind) return null;
  const participant = record(stage.participant);
  return {
    key,
    label,
    kind,
    participantType: text(participant?.type),
    participantUserId: text(participant?.userId),
    onFailStepKey: text(stage.onFailStepKey),
    minScore: finiteNumber(stage.minScore),
    maxScore: finiteNumber(stage.maxScore),
    rubric: text(stage.rubric),
  };
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item): item is string => item !== null);
}

function unwrapRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  const root = record(value);
  if (!root) return null;
  for (const key of keys) {
    const nested = record(root[key]);
    if (nested) return nested;
  }
  return root;
}

function unwrapRows(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const root = record(value);
  if (!root) return [];
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

export function pipelineRunId(value: unknown): string | null {
  return text(unwrapRecord(value, ['run', 'pipelineRun', 'data'])?.id);
}

function semanticCategory(
  eventType: string,
  stage: Record<string, unknown> | null,
  participantType: string | null,
  hasClassifierEvidence: boolean,
): PipelineTraceCategory {
  const stageText = [text(stage?.key), text(stage?.label), text(stage?.kind)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (eventType === 'routing_resolved' || /rout|project select/.test(stageText)) return 'routing';
  if (eventType === 'stage_retry_scheduled') return 'retry';
  if (/classif|triage|tag|scope|intake/.test(stageText)) return 'classifier';
  if (
    participantType === 'user' ||
    text(stage?.kind) === 'approval' ||
    /hitl|human|approval/.test(stageText)
  )
    return 'hitl';
  if (/merge|merger|integrat/.test(stageText)) return 'merge';
  if (eventType === 'stage_created') return 'handoff';
  if (eventType.startsWith('stage_')) return 'stage';
  if (eventType === 'run_created' && hasClassifierEvidence) return 'classifier';
  return 'lifecycle';
}

function eventStatus(eventType: string): PipelineTraceEventStatus {
  if (eventType === 'stage_started') return 'in_progress';
  if (eventType.endsWith('_completed') || eventType === 'routing_resolved') return 'done';
  if (eventType === 'run_blocked') return 'blocked';
  if (eventType.endsWith('_failed')) return 'failed';
  if (eventType.endsWith('_cancelled')) return 'cancelled';
  if (eventType.endsWith('_created') || eventType === 'stage_retry_scheduled') return 'queued';
  return 'event';
}

/**
 * Normalizes the deliberately-untyped read endpoints used by the Hub. Unknown
 * fields are ignored and unknown event types remain visible as generic events.
 * This keeps trace telemetry additive: a backend rollout or malformed row can
 * never make the issue detail page unavailable.
 */
export function normalizePipelineTrace(
  runValue: unknown,
  eventsValue: unknown,
): PipelineTrace | null {
  const run = unwrapRecord(runValue, ['run', 'pipelineRun', 'data']);
  const id = text(run?.id);
  if (!run || !id) return null;

  const snapshot = record(run.pipelineSnapshot) ?? record(run.pipeline) ?? {};
  const routing = record(run.routingSnapshot) ?? record(run.routing) ?? {};
  const steps = unwrapRows(snapshot.steps, []);
  const stages = new Map<string, Record<string, unknown>>();
  for (const value of steps) {
    const stage = record(value);
    const key = text(stage?.key ?? stage?.id);
    if (stage && key) stages.set(key, stage);
  }
  const hasClassifierEvidence =
    record(routing.classifierOutput) !== null || texts(routing.inferredLabels).length > 0;

  const events = unwrapRows(eventsValue, ['events', 'items', 'data'])
    .flatMap((value, index): PipelineTraceEvent[] => {
      const row = record(value);
      if (!row) return [];
      const eventType = text(row.eventType ?? row.type) ?? 'unknown_event';
      const stepKey = text(row.stepKey ?? row.stageKey);
      const stage = stepKey ? (stages.get(stepKey) ?? null) : null;
      const participant = record(row.participant) ?? record(stage?.participant);
      const participantType = text(participant?.type);
      const output = record(row.outputSnapshot) ?? record(row.output);
      return [
        {
          id: text(row.id ?? row.eventKey) ?? `${id}-event-${index}`,
          sequence: finiteNumber(row.sequence) ?? index + 1,
          eventType,
          category: semanticCategory(eventType, stage, participantType, hasClassifierEvidence),
          status: eventStatus(eventType),
          stepKey,
          stageLabel: text(stage?.label) ?? stepKey,
          stageKind: text(stage?.kind),
          attempt: finiteNumber(row.attempt),
          childIssueId: text(row.childIssueId),
          score: finiteNumber(row.score),
          maxScore: finiteNumber(row.maxScore),
          resolvedAdapterType: text(row.resolvedAdapterType ?? row.adapterType),
          resolvedModel: text(row.resolvedModel ?? row.model),
          resolvedProvider: text(row.resolvedProvider ?? row.provider),
          harnessRevisionId: text(row.harnessRevisionId),
          participantType,
          outcome: pipelineOutcome(output?.outcome),
          summary: text(output?.summary),
          occurredAt: text(row.occurredAt ?? row.createdAt),
        },
      ];
    })
    .sort((left, right) => left.sequence - right.sequence);

  const currentStepKey = text(run.currentStepKey);

  return {
    id,
    status: text(run.status) ?? 'unknown',
    currentStepKey,
    currentStage: currentStepKey ? traceStage(stages.get(currentStepKey) ?? null) : null,
    sourceOriginKind: text(run.sourceOriginKind),
    sourceOriginId: text(run.sourceOriginId),
    pipelineName: text(snapshot.name ?? run.pipelineName),
    selectedPortfolioId: text(run.selectedPortfolioId ?? routing.selectedPortfolioId),
    selectedProjectId: text(run.selectedProjectId ?? routing.selectedProjectId),
    repository: text(routing.repository),
    resolution: text(routing.resolution),
    confidence: finiteNumber(routing.confidence),
    reason: text(routing.reason),
    originalLabels: texts(routing.originalLabels),
    inferredLabels: texts(routing.inferredLabels),
    startedAt: text(run.startedAt ?? run.createdAt),
    completedAt: text(run.completedAt),
    events,
  };
}
