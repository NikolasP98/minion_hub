import { describe, expect, it } from 'vitest';
import type { PipelineTrace, PipelineTraceStage } from './pipeline-trace';
import {
  activePipelineGate,
  buildInlinePipelineGateMutation,
  buildPipelineGateMutation,
  hasActiveInlinePipelineGate,
  type PipelineGate,
  type PipelineGateIssue,
} from './pipeline-gate';

const approvalStage: PipelineTraceStage = {
  key: 'approval',
  label: 'Human approval',
  kind: 'approval',
  participantType: 'user',
  participantUserId: 'user-1',
  participantRoleKeys: [],
  onFailStepKey: 'implement',
  minScore: null,
  maxScore: null,
  rubric: null,
};

const trace: PipelineTrace = {
  id: 'run-1',
  status: 'active',
  currentStepKey: 'approval',
  currentStage: approvalStage,
  sourceOriginKind: 'github_issue',
  sourceOriginId: 'org/repo#1',
  pipelineName: 'Bug fix',
  selectedPortfolioId: null,
  selectedProjectId: 'project-1',
  repository: 'org/repo',
  resolution: 'rule',
  confidence: 1,
  reason: null,
  originalLabels: ['bug'],
  inferredLabels: [],
  startedAt: null,
  completedAt: null,
  events: [
    {
      id: 'event-1',
      sequence: 1,
      eventType: 'stage_created',
      category: 'hitl',
      status: 'queued',
      stepKey: 'approval',
      stageLabel: 'Human approval',
      stageKind: 'approval',
      attempt: 1,
      childIssueId: 'child-1',
      score: null,
      maxScore: null,
      resolvedAdapterType: null,
      resolvedModel: null,
      resolvedProvider: null,
      harnessRevisionId: null,
      participantType: 'user',
      outcome: null,
      summary: null,
      occurredAt: null,
    },
  ],
};

const issue: PipelineGateIssue = {
  id: 'child-1',
  status: 'todo',
  originKind: 'pipeline_step',
  originId: 'run-1',
  assigneeUserId: 'user-1',
};

describe('activePipelineGate', () => {
  it('recognizes the current todo stage-task assigned to the signed-in HITL user', () => {
    expect(activePipelineGate(issue, trace, 'user-1')).toEqual({
      stage: approvalStage,
      retryStepKey: 'implement',
      permitsEvalScore: false,
    });
  });

  it('recognizes an unassigned role-target stage only for an intersecting trusted viewer role', () => {
    const roleTrace = {
      ...trace,
      currentStage: {
        ...approvalStage,
        participantType: 'role',
        participantUserId: null,
        participantRoleKeys: ['manager', 'security-reviewer'],
      },
    };
    const roleIssue = { ...issue, assigneeUserId: null };

    expect(activePipelineGate(roleIssue, roleTrace, 'user-2', ['security-reviewer'])).toMatchObject(
      {
        stage: { participantType: 'role' },
      },
    );
    expect(activePipelineGate(roleIssue, roleTrace, 'user-2', ['staff'])).toBeNull();
  });

  it('does not let a matching role override a conflicting direct assignment', () => {
    const roleTrace = {
      ...trace,
      currentStage: {
        ...approvalStage,
        participantType: 'role',
        participantUserId: null,
        participantRoleKeys: ['manager'],
      },
    };
    expect(activePipelineGate(issue, roleTrace, 'user-2', ['manager'])).toBeNull();
  });

  it.each([
    ['main issue', { ...issue, originKind: 'github_issue' }, trace, 'user-1'],
    ['terminal child', { ...issue, status: 'done' }, trace, 'user-1'],
    ['different user', issue, trace, 'user-2'],
    ['stale retry child', { ...issue, id: 'old-child' }, trace, 'user-1'],
    ['inactive run', issue, { ...trace, status: 'completed' }, 'user-1'],
    [
      'agent stage',
      issue,
      { ...trace, currentStage: { ...approvalStage, participantType: 'agent' } },
      'user-1',
    ],
  ])('hides controls for a %s', (_label, candidateIssue, candidateTrace, viewer) => {
    expect(activePipelineGate(candidateIssue, candidateTrace, viewer)).toBeNull();
  });
});

describe('inline execution-policy compatibility', () => {
  const inlineIssue: PipelineGateIssue = {
    id: 'main-1',
    status: 'in_review',
    originKind: 'github_issue',
    assigneeUserId: 'user-1',
    executionState: { status: 'pending', currentParticipant: { type: 'user' } },
  };

  it('keeps pending user stages actionable without treating pipeline_step children as inline', () => {
    expect(hasActiveInlinePipelineGate(inlineIssue)).toBe(true);
    expect(hasActiveInlinePipelineGate({ ...inlineIssue, originKind: 'pipeline_step' })).toBe(
      false,
    );
  });

  it('preserves the shipped status/comment/feedbackScore mutation contract', () => {
    expect(
      buildInlinePipelineGateMutation({
        decision: 'approve',
        comment: '  Looks good.  ',
        feedbackScore: 9,
      }),
    ).toEqual({
      ok: true,
      payload: { status: 'done', comment: 'Looks good.', feedbackScore: 9 },
    });
    expect(
      buildInlinePipelineGateMutation({
        decision: 'request_changes',
        comment: 'Add a regression test.',
      }),
    ).toEqual({
      ok: true,
      payload: { status: 'in_progress', comment: 'Add a regression test.' },
    });
  });
});

describe('buildPipelineGateMutation', () => {
  const gate: PipelineGate = {
    stage: approvalStage,
    retryStepKey: 'implement',
    permitsEvalScore: false,
  };

  it('approves with terminal done plus typed passed outcome and a trimmed summary', () => {
    expect(
      buildPipelineGateMutation({ gate, decision: 'approve', summary: '  Plan is actionable.  ' }),
    ).toEqual({
      ok: true,
      payload: {
        status: 'done',
        pipelineOutcome: 'passed',
        pipelineSummary: 'Plan is actionable.',
      },
    });
  });

  it('preserves optional human quality feedback on stage-task approval gates', () => {
    expect(
      buildPipelineGateMutation({
        gate,
        decision: 'approve',
        summary: 'Plan is actionable.',
        feedbackScore: 9,
      }),
    ).toEqual({
      ok: true,
      payload: {
        status: 'done',
        pipelineOutcome: 'passed',
        pipelineSummary: 'Plan is actionable.',
        feedbackScore: 9,
      },
    });
    expect(
      buildPipelineGateMutation({
        gate,
        decision: 'approve',
        summary: 'Plan is actionable.',
        feedbackScore: 11,
      }),
    ).toEqual({ ok: false, error: 'score_invalid' });
  });

  it('requests changes with terminal done plus typed failed outcome so the retry edge fires', () => {
    expect(
      buildPipelineGateMutation({
        gate,
        decision: 'request_changes',
        summary: 'Add regression coverage.',
      }),
    ).toEqual({
      ok: true,
      payload: {
        status: 'done',
        pipelineOutcome: 'failed',
        pipelineSummary: 'Add regression coverage.',
      },
    });
  });

  it('rejects empty summaries and change requests without a configured retry edge', () => {
    expect(buildPipelineGateMutation({ gate, decision: 'approve', summary: '  ' })).toEqual({
      ok: false,
      error: 'summary_required',
    });
    expect(
      buildPipelineGateMutation({
        gate: { ...gate, retryStepKey: null },
        decision: 'request_changes',
        summary: 'Try again.',
      }),
    ).toEqual({ ok: false, error: 'retry_unavailable' });
  });

  it('preserves an explicit eval score but never leaks eval or human scores across gate types', () => {
    expect(
      buildPipelineGateMutation({ gate, decision: 'approve', summary: 'Approved.', evalScore: 9 }),
    ).toEqual({
      ok: true,
      payload: { status: 'done', pipelineOutcome: 'passed', pipelineSummary: 'Approved.' },
    });

    const evalGate: PipelineGate = {
      stage: { ...approvalStage, kind: 'eval', minScore: 7, maxScore: 10 },
      retryStepKey: 'implement',
      permitsEvalScore: true,
    };
    expect(
      buildPipelineGateMutation({
        gate: evalGate,
        decision: 'approve',
        summary: 'Meets the rubric.',
      }),
    ).toEqual({ ok: false, error: 'score_required' });
    expect(
      buildPipelineGateMutation({
        gate: evalGate,
        decision: 'approve',
        summary: 'Meets the rubric.',
        evalScore: 8,
        feedbackScore: 3,
      }),
    ).toEqual({
      ok: true,
      payload: {
        status: 'done',
        pipelineOutcome: 'passed',
        pipelineSummary: 'Meets the rubric.',
        evalScore: 8,
      },
    });
    expect(
      buildPipelineGateMutation({
        gate: evalGate,
        decision: 'approve',
        summary: 'Below threshold.',
        evalScore: 6,
      }),
    ).toEqual({ ok: false, error: 'score_below_threshold' });
  });
});
