import { describe, expect, it } from 'vitest';
import { normalizePipelineTrace, pipelineRunId } from './pipeline-trace';

const run = {
  id: 'run-1',
  status: 'active',
  currentStepKey: 'implement',
  sourceOriginKind: 'github_issue',
  sourceOriginId: 'nikolasp98/minion_hub#56',
  selectedProjectId: 'project-1',
  pipelineSnapshot: {
    name: 'Bug fix',
    steps: [
      { key: 'classify', kind: 'work', label: 'Classify tags', participant: { type: 'agent' } },
      { key: 'approval', kind: 'approval', label: 'Plan approval', participant: { type: 'user' } },
      { key: 'merge', kind: 'work', label: 'Code merger', participant: { type: 'agent' } },
    ],
  },
  routingSnapshot: {
    repository: 'nikolasp98/minion_hub',
    originalLabels: ['bug'],
    inferredLabels: ['scope:auth'],
    classifierOutput: { labels: ['scope:auth'] },
    resolution: 'rule',
    confidence: 0.93,
  },
};

describe('pipeline trace normalization', () => {
  it('unwraps run responses and exposes their id for the dependent events request', () => {
    expect(pipelineRunId({ pipelineRun: run })).toBe('run-1');
    expect(pipelineRunId({ nope: true })).toBeNull();
  });

  it('sorts events and preserves runtime, harness, child, attempt, and score evidence', () => {
    const trace = normalizePipelineTrace(
      { run },
      {
        events: [
          {
            id: 'e2',
            sequence: 2,
            eventType: 'stage_completed',
            stepKey: 'classify',
            attempt: 1,
            childIssueId: 'child-1',
            score: '8.5',
            maxScore: 10,
            resolvedAdapterType: 'minion_drone',
            resolvedModel: 'claude-haiku',
            resolvedProvider: 'anthropic',
            harnessRevisionId: 'revision-1',
          },
          { id: 'e1', sequence: 1, eventType: 'run_created' },
        ],
      },
    );

    expect(trace).toMatchObject({
      id: 'run-1',
      pipelineName: 'Bug fix',
      repository: 'nikolasp98/minion_hub',
      inferredLabels: ['scope:auth'],
    });
    expect(trace?.events.map((event) => event.id)).toEqual(['e1', 'e2']);
    expect(trace?.events[1]).toMatchObject({
      category: 'classifier',
      status: 'done',
      stageLabel: 'Classify tags',
      attempt: 1,
      childIssueId: 'child-1',
      score: 8.5,
      resolvedAdapterType: 'minion_drone',
      harnessRevisionId: 'revision-1',
    });
  });

  it('classifies routing, handoff, retry, HITL, and merge facts from event and frozen stage metadata', () => {
    const trace = normalizePipelineTrace(run, [
      { eventType: 'routing_resolved', sequence: 1 },
      { eventType: 'stage_created', stepKey: 'unknown-work', sequence: 2 },
      { eventType: 'stage_retry_scheduled', stepKey: 'unknown-work', sequence: 3 },
      { eventType: 'stage_started', stepKey: 'approval', sequence: 4 },
      { eventType: 'stage_completed', stepKey: 'merge', sequence: 5 },
    ]);
    expect(trace?.events.map((event) => event.category)).toEqual([
      'routing',
      'handoff',
      'retry',
      'hitl',
      'merge',
    ]);
  });

  it('keeps retry semantics visible even when the retried stage is the classifier', () => {
    const trace = normalizePipelineTrace(run, [
      { eventType: 'stage_retry_scheduled', stepKey: 'classify', sequence: 1 },
    ]);
    expect(trace?.events[0].category).toBe('retry');
  });

  it('fails closed to no trace for malformed runs while retaining unknown event types', () => {
    expect(normalizePipelineTrace(null, [])).toBeNull();
    expect(normalizePipelineTrace({ id: '' }, [{ eventType: 'future_event' }])).toBeNull();
    expect(
      normalizePipelineTrace(run, { data: [{ type: 'future_event' }, null, 'bad-row'] })?.events[0],
    ).toMatchObject({ eventType: 'future_event', category: 'lifecycle', status: 'event' });
  });
});
