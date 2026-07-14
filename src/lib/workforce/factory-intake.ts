export type FactoryIntakeState =
  | 'scouting'
  | 'awaiting_routing_approval'
  | 'pipeline_active'
  | 'completed'
  | 'rejected'
  | 'failed'
  | string;

export type FactoryIntakeView = {
  issueId: string;
  identifier: string;
  title: string;
  status: string;
  state: FactoryIntakeState;
  portfolio: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  routingDecision: {
    resolution: 'rule' | 'intake_fallback' | 'override' | 'unresolved';
    confidence: number | null;
    reason: string | null;
    candidates: FactoryRoutingCandidate[];
    newProjectProposal: { name: string; description: string } | null;
  } | null;
  pipelineRunId: string | null;
  issueHref: string;
  projectHref: string | null;
  workHref: '/work';
};

export type FactoryRoutingCandidate = {
  projectId: string;
  key: string;
  name: string;
  repositoryKey: string;
  groupKey: string | null;
  confidence: number | null;
  reason: string;
};

export type FactoryIntakeAttempt = { request: string; idempotencyKey: string };

export function factoryIntakeAttempt(
  current: FactoryIntakeAttempt | null,
  request: string,
  createId: () => string,
): FactoryIntakeAttempt {
  if (current?.request === request) return current;
  return { request, idempotencyKey: `assistant:${createId()}` };
}

export function recommendedRoutingCandidate(
  candidates: readonly FactoryRoutingCandidate[],
): FactoryRoutingCandidate | null {
  const scored = candidates.filter((candidate) => candidate.confidence !== null);
  if (scored.length === 0) return null;
  return [...scored].sort((left, right) => (right.confidence ?? -1) - (left.confidence ?? -1))[0];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function named(value: unknown): { id: string; name: string } | null {
  const row = record(value);
  const id = text(row?.id);
  if (!id) return null;
  return { id, name: text(row?.name) ?? id };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function routingCandidate(value: unknown): FactoryRoutingCandidate | null {
  const row = record(value);
  const projectId = text(row?.projectId);
  if (!projectId) return null;
  return {
    projectId,
    key: text(row?.key) ?? projectId,
    name: text(row?.name) ?? projectId,
    repositoryKey: text(row?.repositoryKey) ?? '',
    groupKey: text(row?.groupKey),
    confidence: finiteNumber(row?.confidence),
    reason: text(row?.reason) ?? '',
  };
}

function routingDecision(value: unknown): FactoryIntakeView['routingDecision'] {
  const row = record(value);
  const resolution = text(row?.resolution);
  if (
    !row ||
    !resolution ||
    !['rule', 'intake_fallback', 'override', 'unresolved'].includes(resolution)
  ) {
    return null;
  }
  const proposal = record(row.newProjectProposal);
  const proposalName = text(proposal?.name);
  return {
    resolution: resolution as NonNullable<FactoryIntakeView['routingDecision']>['resolution'],
    confidence: finiteNumber(row.confidence),
    reason: text(row.reason),
    candidates: Array.isArray(row.candidates)
      ? row.candidates.flatMap((candidate) => {
          const normalized = routingCandidate(candidate);
          return normalized ? [normalized] : [];
        })
      : [],
    newProjectProposal: proposalName
      ? { name: proposalName, description: text(proposal?.description) ?? '' }
      : null,
  };
}

/**
 * Keep the assistant card independent from backend links: every navigation URL
 * is reconstructed as a same-origin Hub route from validated ids.
 */
export function normalizeFactoryIntake(value: unknown): FactoryIntakeView | null {
  const root = record(value);
  const intake = record(root?.intake);
  const rootIssue = record(root?.rootIssue);
  const pipelineRun = record(root?.pipelineRun);
  const issueId = text(rootIssue?.id) ?? text(intake?.id);
  if (!root || !intake || !issueId) return null;

  const project = named(root.project);
  return {
    issueId,
    identifier: text(intake.identifier) ?? text(rootIssue?.identifier) ?? issueId,
    title: text(rootIssue?.title) ?? text(intake.title) ?? 'Factory intake',
    status: text(intake.status) ?? text(rootIssue?.status) ?? 'todo',
    state: text(intake.state) ?? 'scouting',
    portfolio: named(root.portfolio),
    project,
    routingDecision: routingDecision(root.routingDecision),
    pipelineRunId: text(pipelineRun?.id),
    issueHref: `/workforce/issues/${encodeURIComponent(issueId)}`,
    projectHref: project ? `/workforce/projects/${encodeURIComponent(project.id)}` : null,
    workHref: '/work',
  };
}

export function factoryIntakeIsSettled(intake: FactoryIntakeView): boolean {
  return intake.state !== 'scouting';
}
