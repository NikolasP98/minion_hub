import { describe, expect, it } from 'vitest';
import { normalizeInboxResponse } from './pipeline-inbox';

const notification = {
  id: 'note-1',
  type: 'comment',
  title: 'A comment arrived',
  body: 'Review the latest note.',
  actorAgentId: 'agent-1',
  actorUserId: null,
  entityType: 'issue',
  entityId: 'main-1',
  href: '/workforce/issues/main-1',
  createdAt: '2026-07-13T12:00:00.000Z',
  readAt: null,
};

const pipelineTask = {
  id: 'inbox-child-1',
  type: 'approval',
  issueId: 'child-1',
  rootIssueId: 'main-1',
  runId: 'run-1',
  pipelineId: 'pipeline-1',
  pipelineName: 'Bug fix',
  projectId: 'project-1',
  title: 'Approve the implementation plan',
  description: 'Confirm the proposed tests and scope.',
  status: 'todo',
  href: '/issues/child-1',
  createdAt: '2026-07-13T13:00:00.000Z',
  updatedAt: '2026-07-13T13:00:00.000Z',
  stageKey: 'plan-approval',
  stageLabel: 'Plan approval',
  stageKind: 'approval',
  attempt: 1,
  target: { type: 'user', userId: 'user-1' },
  participantUserId: 'user-1',
  participantRoleKeys: [],
};

describe('normalizeInboxResponse', () => {
  it('preserves the existing bare notification-array response', () => {
    expect(normalizeInboxResponse([notification], { userId: 'user-1', roleKeys: [] })).toEqual([
      notification,
    ]);
  });

  it('adds the current live HITL child assigned to the exact viewer', () => {
    const items = normalizeInboxResponse(
      { items: [notification], pipelineTasks: [pipelineTask] },
      { userId: 'user-1', roleKeys: ['staff'] },
    );

    expect(items.map((item) => item.id)).toEqual(['pipeline-hitl:inbox-child-1', 'note-1']);
    expect(items[0]).toMatchObject({
      type: 'pipeline_hitl',
      entityId: 'child-1',
      href: '/workforce/issues/child-1',
      stageLabel: 'Plan approval',
      assignmentKind: 'user',
      assignmentRoleKeys: [],
    });
  });

  it('accepts an unassigned role-target stage only for an intersecting trusted viewer role', () => {
    const roleTask = {
      ...pipelineTask,
      target: { type: 'role', roleKeys: ['manager', 'security-reviewer'] },
      participantUserId: null,
      participantRoleKeys: ['manager', 'security-reviewer'],
    };

    const eligible = normalizeInboxResponse(
      { pipelineTasks: [roleTask] },
      { userId: 'user-2', roleKeys: ['staff', 'security-reviewer'] },
    );
    expect(eligible[0]).toMatchObject({
      assignmentKind: 'role',
      assignmentRoleKeys: ['security-reviewer'],
    });
    expect(
      normalizeInboxResponse(
        { pipelineTasks: [roleTask] },
        { userId: 'user-2', roleKeys: ['staff'] },
      ),
    ).toEqual([]);
  });

  it.each([
    ['terminal child', { status: 'done' }],
    ['blocked child', { status: 'blocked' }],
    ['missing run evidence', { runId: null }],
    ['non-HITL stage', { stageKind: 'work' }],
    [
      'different direct user',
      { target: { type: 'user', userId: 'user-2' }, participantUserId: 'user-2' },
    ],
  ])('drops a %s', (_label, patch) => {
    expect(
      normalizeInboxResponse(
        { pipelineTasks: [{ ...pipelineTask, ...patch }] },
        { userId: 'user-1', roleKeys: ['staff'] },
      ),
    ).toEqual([]);
  });

  it('does not use role membership to override a conflicting direct assignment', () => {
    expect(
      normalizeInboxResponse(
        {
          pipelineTasks: [
            {
              ...pipelineTask,
              target: { type: 'user', userId: 'user-2' },
              participantUserId: 'user-2',
              participantRoleKeys: ['staff'],
            },
          ],
        },
        { userId: 'user-1', roleKeys: ['staff'] },
      ),
    ).toEqual([]);
  });

  it('never downgrades an ineligible pipeline projection to a legacy approval notification', () => {
    expect(
      normalizeInboxResponse([pipelineTask], { userId: 'user-2', roleKeys: ['staff'] }),
    ).toEqual([]);
  });

  it('fails closed for malformed additive payloads while retaining valid notifications', () => {
    expect(
      normalizeInboxResponse(
        {
          items: [notification, { type: 'future' }],
          pipelineTasks: [{ ...pipelineTask, runId: null }],
        },
        { userId: 'user-1', roleKeys: [] },
      ),
    ).toEqual([notification]);
  });
});
