import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { PipelineTrace } from '$lib/workforce/pipeline-trace';
import PipelineGateControls from './PipelineGateControls.svelte';

const trace = {
  id: 'run-1',
  status: 'active',
  currentStepKey: 'approval',
  currentStage: {
    key: 'approval',
    label: 'Human approval',
    kind: 'approval',
    participantType: 'user',
    participantUserId: 'user-1',
    onFailStepKey: 'implement',
    minScore: null,
    maxScore: null,
    rubric: null,
  },
  events: [
    {
      id: 'event-1',
      sequence: 1,
      eventType: 'stage_created',
      stepKey: 'approval',
      childIssueId: 'child-1',
    },
  ],
} as PipelineTrace;

const issue = {
  id: 'child-1',
  status: 'todo',
  originKind: 'pipeline_step',
  originId: 'run-1',
  assigneeUserId: 'user-1',
};

function renderGate(workforceAvailable: boolean, canEdit = true): string {
  return render(PipelineGateControls, {
    props: {
      issue,
      trace,
      viewerUserId: 'user-1',
      workforceAvailable,
      canEdit,
    },
  }).body;
}

function renderInlineGate(): string {
  return render(PipelineGateControls, {
    props: {
      issue: {
        id: 'main-1',
        status: 'in_review',
        originKind: 'github_issue',
        assigneeUserId: 'user-1',
        executionState: { status: 'pending', currentParticipant: { type: 'user' } },
      },
      trace: null,
      viewerUserId: 'user-1',
      workforceAvailable: true,
      canEdit: true,
    },
  }).body;
}

describe('PipelineGateControls', () => {
  it('renders explicit approval and request-changes controls for the current HITL child', () => {
    const body = renderGate(true);
    expect(body).toContain('Human decision');
    expect(body).toContain('Decision summary');
    expect(body).toContain('Approve');
    expect(body).toContain('Request changes');
    expect(body).toContain('retries implement');
    expect(body).not.toContain('Approve → Done');
  });

  it('keeps the gate visible but renders inert controls while the backend is unavailable', () => {
    const body = renderGate(false);
    expect(body).toContain('Human decision');
    expect(body).toContain('The workforce backend is unavailable.');
    expect(body.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('renders inert controls without project edit permission', () => {
    const body = renderGate(true, false);
    expect(body).toContain('You need project edit permission');
    expect(body.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the legacy inline execution-policy gate actionable', () => {
    const body = renderInlineGate();
    expect(body).toContain('Issue approval');
    expect(body).toContain('Quality score (optional, 0–10)');
    expect(body).toContain('Approve');
    expect(body).toContain('Request changes');
  });
});
