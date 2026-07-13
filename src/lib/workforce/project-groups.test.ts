import { describe, expect, it } from 'vitest';
import {
  explicitProjectGrouping,
  groupProjectsByMetadata,
  UNGROUPED_PROJECT_KEY,
} from './project-groups';

type ProjectStub = {
  id: string;
  name: string;
  metadata?: unknown;
  repoUrl?: string;
};

describe('explicitProjectGrouping', () => {
  it('reads and trims only explicit project metadata', () => {
    expect(
      explicitProjectGrouping({
        metadata: { repositoryKey: ' minion-hub ', groupKey: ' auth ' },
      }),
    ).toEqual({ repositoryKey: 'minion-hub', groupKey: 'auth' });
  });

  it('does not infer grouping from project names, URLs, or paths', () => {
    const project: ProjectStub = {
      id: 'project-1',
      name: 'Minion Hub Auth',
      repoUrl: 'https://github.com/NikolasP98/minion_hub',
      metadata: null,
    };
    expect(explicitProjectGrouping(project)).toEqual({
      repositoryKey: null,
      groupKey: null,
    });
  });

  it('treats empty and non-string metadata values as ungrouped', () => {
    expect(
      explicitProjectGrouping({
        metadata: { repositoryKey: ' ', groupKey: 42 },
      }),
    ).toEqual({ repositoryKey: null, groupKey: null });
  });
});

describe('groupProjectsByMetadata', () => {
  it('groups by repository and concern with deterministic ordering', () => {
    const projects: ProjectStub[] = [
      { id: '3', name: 'Core API', metadata: { repositoryKey: 'minion', groupKey: 'core' } },
      {
        id: '1',
        name: 'Hub Sessions',
        metadata: { repositoryKey: 'minion-hub', groupKey: 'sessions' },
      },
      { id: '2', name: 'Hub Auth', metadata: { repositoryKey: 'minion-hub', groupKey: 'auth' } },
    ];

    const result = groupProjectsByMetadata(projects);
    expect(result.map((repository) => repository.repositoryKey)).toEqual(['minion', 'minion-hub']);
    expect(result[1]?.groups.map((group) => group.groupKey)).toEqual(['auth', 'sessions']);
    expect(result[1]?.groups[0]?.projects.map((project) => project.id)).toEqual(['2']);
  });

  it('uses stable fallback groups and sorts them last', () => {
    const projects: ProjectStub[] = [
      { id: 'missing-repository', name: 'Loose', metadata: { groupKey: 'core' } },
      { id: 'missing-concern', name: 'Hub Other', metadata: { repositoryKey: 'minion-hub' } },
      {
        id: 'grouped',
        name: 'Hub Auth',
        metadata: { repositoryKey: 'minion-hub', groupKey: 'auth' },
      },
    ];

    const result = groupProjectsByMetadata(projects);
    expect(result.map((repository) => repository.key)).toEqual([
      'repository:minion-hub',
      UNGROUPED_PROJECT_KEY,
    ]);
    expect(result[0]?.groups.map((group) => group.key)).toEqual([
      'group:auth',
      UNGROUPED_PROJECT_KEY,
    ]);
    expect(result[1]?.groups[0]?.groupKey).toBe('core');
  });

  it('does not collide explicit values with the ungrouped sentinel', () => {
    const result = groupProjectsByMetadata<ProjectStub>([
      { id: 'explicit', name: 'Explicit', metadata: { repositoryKey: UNGROUPED_PROJECT_KEY } },
      { id: 'missing', name: 'Missing', metadata: null },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((repository) => repository.key)).toEqual([
      `repository:${UNGROUPED_PROJECT_KEY}`,
      UNGROUPED_PROJECT_KEY,
    ]);
  });
});
