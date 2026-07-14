import { describe, expect, it } from 'vitest';
import {
  factoryIntakeAttempt,
  factoryIntakeIsSettled,
  factoryRepositoryKeys,
  normalizeFactoryScopes,
  normalizeFactoryIntake,
  recommendedRoutingCandidate,
  selectableRoutingCandidates,
} from './factory-intake';

describe('normalizeFactoryIntake', () => {
  it('normalizes a routed result and rebuilds trusted Hub links', () => {
    const result = normalizeFactoryIntake({
      intake: { id: 'issue-1', identifier: 'MIN-1400', status: 'todo', state: 'pipeline_active' },
      rootIssue: { id: 'issue-1', title: 'Add factory intake' },
      portfolio: { id: 'portfolio-1', name: 'MINION CODE' },
      project: { id: 'project-1', name: 'Hub' },
      pipelineRun: { id: 'run-1' },
      links: { issueHref: 'https://evil.example/issue-1' },
    });

    expect(result).toMatchObject({
      issueId: 'issue-1',
      identifier: 'MIN-1400',
      state: 'pipeline_active',
      issueHref: '/workforce/issues/issue-1',
      projectHref: '/workforce/projects/project-1',
      workHref: '/work',
    });
    expect(factoryIntakeIsSettled(result!)).toBe(true);
  });

  it('keeps an ambiguous intake pointed at the canonical My Work queue', () => {
    const result = normalizeFactoryIntake({
      intake: {
        id: 'issue-2',
        identifier: 'MIN-1401',
        status: 'in_review',
        state: 'awaiting_routing_approval',
      },
      rootIssue: { id: 'issue-2', title: 'Cross-repo change' },
      routingDecision: { issueId: 'child-2' },
    });
    expect(result).toMatchObject({
      routingDecision: null,
      project: null,
      workHref: '/work',
    });
  });

  it('normalizes defensive routing candidates and a governed project proposal', () => {
    const result = normalizeFactoryIntake({
      intake: { id: 'issue-3', state: 'awaiting_routing_approval' },
      rootIssue: { id: 'issue-3', title: 'Ambiguous feature' },
      routingDecision: {
        resolution: 'unresolved',
        confidence: 0.63,
        reason: 'Two lines share the scope.',
        candidates: [
          {
            projectId: 'project-hub',
            key: 'hub',
            name: 'Hub',
            repositoryKey: 'NikolasP98/minion_hub',
            groupKey: 'apps',
            confidence: 0.63,
            reason: 'Owns the assistant UI.',
          },
          { name: 'malformed' },
        ],
        newProjectProposal: { name: 'Factory UX', description: 'Cross-project control desk.' },
      },
    });
    expect(result?.routingDecision).toMatchObject({
      resolution: 'unresolved',
      confidence: 0.63,
      candidates: [{ projectId: 'project-hub', repositoryKey: 'NikolasP98/minion_hub' }],
      newProjectProposal: { name: 'Factory UX' },
    });
  });

  it('fails closed when issue identity is absent', () => {
    expect(normalizeFactoryIntake({ intake: { state: 'scouting' } })).toBeNull();
  });
});

describe('factoryIntakeAttempt', () => {
  it('reuses a key for the same draft after a lost response and rotates for new text', () => {
    let n = 0;
    const createId = () => `uuid-${++n}`;
    const first = factoryIntakeAttempt(null, 'Build it', createId);
    expect(factoryIntakeAttempt(first, 'Build it', createId)).toBe(first);
    expect(factoryIntakeAttempt(first, 'Build something else', createId)).toEqual({
      request: 'Build something else',
      idempotencyKey: 'assistant:uuid-2',
    });
  });
});

describe('recommendedRoutingCandidate', () => {
  it('uses classifier confidence instead of candidate array order', () => {
    const candidates = [
      {
        projectId: 'first',
        key: 'first',
        name: 'First',
        repositoryKey: '',
        groupKey: null,
        confidence: null,
        reason: '',
      },
      {
        projectId: 'second',
        key: 'second',
        name: 'Second',
        repositoryKey: '',
        groupKey: null,
        confidence: 0.82,
        reason: '',
      },
    ];
    expect(recommendedRoutingCandidate(candidates)?.projectId).toBe('second');
  });

  it('never recommends or exposes the governed intake fallback as a delivery target', () => {
    const candidates = [
      {
        projectId: 'intake',
        key: 'bug-triage',
        name: 'Bug Triage',
        repositoryKey: '*',
        groupKey: null,
        confidence: 0.99,
        reason: 'intake_fallback',
      },
      {
        projectId: 'hub',
        key: 'hub',
        name: 'Hub',
        repositoryKey: 'NikolasP98/minion_hub',
        groupKey: 'apps',
        confidence: 0.72,
        reason: 'factory_candidate',
      },
    ];

    expect(selectableRoutingCandidates(candidates).map((candidate) => candidate.projectId)).toEqual(
      ['hub'],
    );
    expect(recommendedRoutingCandidate(candidates)?.projectId).toBe('hub');
    expect(factoryRepositoryKeys(candidates)).toEqual(['NikolasP98/minion_hub']);
  });
});

describe('normalizeFactoryScopes', () => {
  it('keeps only unique scopes supported by the factory contract', () => {
    expect(normalizeFactoryScopes(['workforce', 'assistant', '', 42, 'ui', 'workforce'])).toEqual([
      'workforce',
      'ui',
    ]);
  });
});
