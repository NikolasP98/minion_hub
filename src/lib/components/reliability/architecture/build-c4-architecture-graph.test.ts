import { describe, expect, it } from 'vitest';
import { C4_MODEL } from '$server/services/architecture-c4.model';
import type { ArchitectureSnapshot } from '$server/services/architecture.service';
import {
  buildC4ArchitectureGraph,
  c4FocusLevel,
  c4ParentFocusTarget,
  c4LevelColor,
  c4RelationStyle,
} from './build-c4-architecture-graph';

const snapshot: ArchitectureSnapshot = {
  nodes: [],
  edges: [],
  c4: C4_MODEL,
  checkedAt: 0,
};

describe('buildC4ArchitectureGraph', () => {
  it('adds nodes cumulatively as the maximum C4 level increases', () => {
    const context = buildC4ArchitectureGraph(snapshot, 'context');
    const containers = buildC4ArchitectureGraph(snapshot, 'container');
    const components = buildC4ArchitectureGraph(snapshot, 'component');
    const code = buildC4ArchitectureGraph(snapshot, 'code');

    expect(context.nodes.every((node) => node.id.startsWith('c4:'))).toBe(true);
    expect(context.nodes.length).toBeLessThan(containers.nodes.length);
    expect(containers.nodes.length).toBeLessThan(components.nodes.length);
    expect(components.nodes.length).toBeLessThan(code.nodes.length);
  });

  it('pins a selected branch root at the center and excludes unrelated branches', () => {
    const graph = buildC4ArchitectureGraph(snapshot, 'code', 'c4:hub');
    const hub = graph.nodes.find((node) => node.id === 'c4:hub');

    expect(hub).toMatchObject({ ax: 0, ay: 0, pinned: true });
    expect(graph.visibleIds.has('c4:gateway')).toBe(false);
    expect(graph.visibleIds.has('c4:hub:reliability')).toBe(true);
    expect(graph.visibleIds.has('c4:code:arch-api')).toBe(true);
    expect(graph.rings).toEqual([300, 600]);
  });

  it('resolves a focused root parent from the complete model', () => {
    const graph = buildC4ArchitectureGraph(snapshot, 'code', 'c4:hub:reliability');

    expect(graph.metaById.has('c4:hub')).toBe(false);
    expect(c4ParentFocusTarget(snapshot.c4, 'c4:hub:reliability')).toBe('c4:hub');
  });

  it('always advances a focus action by exactly one C4 level', () => {
    expect(c4FocusLevel('context')).toBe('container');
    expect(c4FocusLevel('container')).toBe('component');
    expect(c4FocusLevel('component')).toBe('code');
    expect(c4FocusLevel('code')).toBe('code');
  });

  it('rolls hidden container relationships up to the system in context view', () => {
    const graph = buildC4ArchitectureGraph(snapshot, 'context');

    expect(
      graph.edges.some((edge) => edge.source === 'c4:operator' && edge.target === 'c4:minion'),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.source === 'c4:minion' && edge.target === 'c4:channel-platforms',
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) => edge.source === 'c4:minion' && edge.target === 'c4:business-systems',
      ),
    ).toBe(true);
    expect(
      graph.edges.some((edge) => edge.source === 'c4:delivery' && edge.target === 'c4:minion'),
    ).toBe(true);
  });

  it.each([
    ['c4:operator', ['c4:hub', 'c4:site']],
    ['c4:channel-platforms', ['c4:gateway']],
    ['c4:business-systems', ['c4:hub']],
    ['c4:delivery', ['c4:gateway', 'c4:hub', 'c4:site']],
  ])('reveals connected container branches when %s is focused', (focusId, containerIds) => {
    const containers = buildC4ArchitectureGraph(snapshot, 'container', focusId);

    expect(containers.visibleIds.has(focusId)).toBe(true);
    for (const containerId of containerIds) {
      expect(containers.visibleIds.has(containerId)).toBe(true);
      expect(
        containers.edges.some(
          (edge) =>
            (edge.source === focusId && edge.target === containerId) ||
            (edge.source === containerId && edge.target === focusId),
        ),
      ).toBe(true);
    }
  });

  it('keeps projecting descendants beneath a connected external branch', () => {
    const code = buildC4ArchitectureGraph(snapshot, 'code', 'c4:channel-platforms');

    expect(code.visibleIds.has('c4:gateway:http')).toBe(true);
    expect(code.visibleIds.has('c4:code:gateway-server')).toBe(true);
  });

  it('never emits an edge whose endpoint is hidden', () => {
    const graph = buildC4ArchitectureGraph(snapshot, 'component', 'c4:gateway');
    for (const edge of graph.edges) {
      expect(graph.visibleIds.has(edge.source)).toBe(true);
      expect(graph.visibleIds.has(edge.target)).toBe(true);
    }
  });

  it('draws directional arrows for interactions but not containment', () => {
    const graph = buildC4ArchitectureGraph(snapshot, 'code');
    expect(graph.edges.some((edge) => edge.directed === true)).toBe(true);
    expect(graph.edges.some((edge) => edge.directed === false)).toBe(true);
  });

  it('keeps level borders and relation styles semantically distinct', () => {
    const levelColors = new Set(
      (['context', 'container', 'component', 'code'] as const).map(c4LevelColor),
    );
    const relationStyles = (['runtime', 'data', 'event', 'deploy', 'ownership'] as const).map(
      c4RelationStyle,
    );

    expect(levelColors.size).toBe(4);
    expect(relationStyles.find((style) => style.dashed === true)).toBeDefined();
    expect(relationStyles.find((style) => style.dashed === false)).toBeDefined();
    expect(new Set(relationStyles.map((style) => style.color)).size).toBeGreaterThanOrEqual(4);
  });
});
