import { describe, expect, it } from 'vitest';
import { workforceWorkItems } from './work-queue';

const gate = {
  id: 'inbox-gate-1',
  type: 'approval',
  issueId: 'stage-task-1',
  rootIssueId: 'feature-1',
  runId: 'run-1',
  pipelineId: 'pipeline-1',
  pipelineName: 'Feature delivery',
  projectId: 'project-1',
  title: 'Choose the target production line',
  description: 'The scout found two plausible projects.',
  status: 'todo',
  createdAt: '2026-07-13T13:00:00.000Z',
  stageKey: 'routing-decision',
  stageLabel: 'Routing decision',
  stageKind: 'approval',
  attempt: 1,
  target: { type: 'user', userId: 'user-1' },
  participantUserId: 'user-1',
  participantRoleKeys: [],
};

describe('workforceWorkItems', () => {
  it('projects an exact-user HITL gate into the canonical My Work shape', () => {
    expect(
      workforceWorkItems({ pipelineTasks: [gate] }, { userId: 'user-1', roleKeys: [] }),
    ).toEqual([
      expect.objectContaining({
        docType: 'workforce_hitl',
        id: 'pipeline-hitl:inbox-gate-1',
        title: 'Choose the target production line',
        href: '/workforce/issues/stage-task-1',
        pipelineName: 'Feature delivery',
        stageLabel: 'Routing decision',
        assignmentKind: 'user',
      }),
    ]);
  });

  it('shows role-scoped gates only when the signed viewer role intersects', () => {
    const roleGate = {
      ...gate,
      target: { type: 'role', roleKeys: ['architect', 'maintainer'] },
      participantUserId: null,
      participantRoleKeys: ['architect', 'maintainer'],
    };

    expect(
      workforceWorkItems(
        { pipelineTasks: [roleGate] },
        { userId: 'user-2', roleKeys: ['maintainer'] },
      )[0],
    ).toMatchObject({ assignmentKind: 'role', assignmentRoleKeys: ['maintainer'] });
    expect(
      workforceWorkItems({ pipelineTasks: [roleGate] }, { userId: 'user-2', roleKeys: ['viewer'] }),
    ).toEqual([]);
  });

  it('never lets a role match override a gate assigned to another user', () => {
    expect(
      workforceWorkItems(
        {
          pipelineTasks: [
            {
              ...gate,
              target: { type: 'user', userId: 'user-2' },
              participantUserId: 'user-2',
              participantRoleKeys: ['maintainer'],
            },
          ],
        },
        { userId: 'user-1', roleKeys: ['maintainer'] },
      ),
    ).toEqual([]);
  });
});
