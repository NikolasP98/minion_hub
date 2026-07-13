export const UNGROUPED_PROJECT_KEY = '__ungrouped__';

/**
 * Narrow compatibility shape until @minion-stack/workforce-client publishes
 * the Project.metadata contract added in meta-repo commit 2ecc304.
 */
export type ProjectMetadataCarrier = {
  metadata?: unknown;
};

export type ExplicitProjectGrouping = {
  repositoryKey: string | null;
  groupKey: string | null;
};

export type ProjectConcernGroup<T> = {
  key: string;
  groupKey: string | null;
  projects: T[];
};

export type ProjectRepositoryGroup<T> = {
  key: string;
  repositoryKey: string | null;
  groups: ProjectConcernGroup<T>[];
};

function explicitKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/** Read only the stable metadata contract. Never infer groups from display data. */
export function explicitProjectGrouping(project: ProjectMetadataCarrier): ExplicitProjectGrouping {
  const metadata =
    project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
      ? (project.metadata as Record<string, unknown>)
      : null;
  return {
    repositoryKey: explicitKey(metadata?.repositoryKey),
    groupKey: explicitKey(metadata?.groupKey),
  };
}

function compareGroupKey(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function stableMapKey(kind: 'repository' | 'group', value: string | null): string {
  return value == null ? UNGROUPED_PROJECT_KEY : `${kind}:${value}`;
}

/**
 * Group projects by repository, then concern. Missing explicit keys receive a
 * stable fallback key and sort after named groups.
 */
export function groupProjectsByMetadata<T extends ProjectMetadataCarrier>(
  projects: readonly T[],
): ProjectRepositoryGroup<T>[] {
  const repositories = new Map<
    string,
    { repositoryKey: string | null; groups: Map<string, ProjectConcernGroup<T>> }
  >();

  for (const project of projects) {
    const { repositoryKey, groupKey } = explicitProjectGrouping(project);
    const repositoryMapKey = stableMapKey('repository', repositoryKey);
    const groupMapKey = stableMapKey('group', groupKey);
    let repository = repositories.get(repositoryMapKey);
    if (!repository) {
      repository = { repositoryKey, groups: new Map() };
      repositories.set(repositoryMapKey, repository);
    }
    let group = repository.groups.get(groupMapKey);
    if (!group) {
      group = { key: groupMapKey, groupKey, projects: [] };
      repository.groups.set(groupMapKey, group);
    }
    group.projects.push(project);
  }

  return [...repositories.entries()]
    .map(([key, repository]) => ({
      key,
      repositoryKey: repository.repositoryKey,
      groups: [...repository.groups.values()].sort((left, right) =>
        compareGroupKey(left.groupKey, right.groupKey),
      ),
    }))
    .sort((left, right) => compareGroupKey(left.repositoryKey, right.repositoryKey));
}
