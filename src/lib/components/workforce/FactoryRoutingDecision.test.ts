import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { PipelineTrace } from '$lib/workforce/pipeline-trace';
import type { FactoryIntakeView } from '$lib/workforce/factory-intake';
import FactoryRoutingDecision from './FactoryRoutingDecision.svelte';

const issue = {
  id: 'routing-child-1',
  status: 'todo',
  originKind: 'pipeline_step',
  originId: 'run-1',
  assigneeUserId: 'user-1',
};

const trace = {
  id: 'run-1',
  status: 'active',
  currentStepKey: 'routing-decision',
  currentStage: {
    key: 'routing-decision',
    label: 'Routing decision',
    kind: 'approval',
    participantType: 'user',
    participantUserId: 'user-1',
    participantRoleKeys: [],
  },
  events: [
    {
      id: 'e1',
      sequence: 1,
      eventType: 'stage_created',
      stepKey: 'routing-decision',
      childIssueId: 'routing-child-1',
    },
  ],
} as unknown as PipelineTrace;

const intake = {
  issueId: 'root-1',
  identifier: 'MIN-1400',
  title: 'Add factory controls',
  status: 'in_review',
  state: 'awaiting_routing_approval',
  portfolio: { id: 'portfolio-1', name: 'MINION CODE' },
  project: null,
  routingDecision: {
    resolution: 'unresolved',
    confidence: 0.75,
    reason: 'Two projects overlap.',
    candidates: [
      {
        projectId: 'core',
        key: 'core',
        name: 'Core',
        repositoryKey: 'NikolasP98/minion-ai',
        groupKey: 'platform',
        confidence: null,
        reason: 'Shares orchestration primitives.',
      },
      {
        projectId: 'hub',
        key: 'hub',
        name: 'Hub',
        repositoryKey: 'NikolasP98/minion_hub',
        groupKey: 'apps',
        confidence: 0.75,
        reason: 'Owns the assistant.',
      },
    ],
    newProjectProposal: { name: 'Factory UX', description: 'A new production line.' },
  },
  pipelineRunId: 'run-1',
  issueHref: '/workforce/issues/root-1',
  projectHref: null,
  workHref: '/work',
} satisfies FactoryIntakeView;

function body(viewerUserId: string, sourceTrace = trace, sourceIssue = issue): string {
  return render(FactoryRoutingDecision, {
    props: {
      issue: sourceIssue,
      trace: sourceTrace,
      intake,
      viewerUserId,
      viewerRoleKeys: [],
      workforceAvailable: true,
      canEdit: true,
    },
  }).body;
}

describe('FactoryRoutingDecision', () => {
  it('renders the typed three-way decision for the exact assigned user', () => {
    const html = body('user-1');
    expect(html).toContain('Choose a production line');
    expect(html).toContain('Hub');
    expect(html.indexOf('Core')).toBeLessThan(html.indexOf('Hub'));
    expect(html.indexOf('Hub')).toBeLessThan(html.indexOf('Recommended'));
    expect(html).toContain('New governed project');
    expect(html).toContain('Reject intake');
  });

  it('does not reveal the decision to another user', () => {
    expect(body('user-2')).not.toContain('Choose a production line');
  });

  it('renders a role-scoped decision only for a trusted matching role', () => {
    const roleTrace = {
      ...trace,
      currentStage: {
        ...trace.currentStage!,
        participantType: 'role',
        participantUserId: null,
        participantRoleKeys: ['architect'],
      },
    };
    const roleIssue = { ...issue, assigneeUserId: null };
    const eligible = render(FactoryRoutingDecision, {
      props: {
        issue: roleIssue,
        trace: roleTrace,
        intake,
        viewerUserId: 'user-2',
        viewerRoleKeys: ['architect'],
        workforceAvailable: true,
        canEdit: true,
      },
    }).body;
    const ineligible = render(FactoryRoutingDecision, {
      props: {
        issue: roleIssue,
        trace: roleTrace,
        intake,
        viewerUserId: 'user-2',
        viewerRoleKeys: ['viewer'],
        workforceAvailable: true,
        canEdit: true,
      },
    }).body;
    expect(eligible).toContain('Choose a production line');
    expect(ineligible).not.toContain('Choose a production line');
  });
});
