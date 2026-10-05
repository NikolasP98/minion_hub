// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const graph = vi.hoisted(() => {
  const renderer = {
    destroy: vi.fn(),
    frame: vi.fn(),
    setGraph: vi.fn(),
    setGroups: vi.fn(),
    updatePresentation: vi.fn(),
    setFocus: vi.fn(),
    fitParamsAround: vi.fn(() => null),
    animateTo: vi.fn(),
    fitView: vi.fn(),
    nodePosition: vi.fn(() => null),
    nodeScreenPosition: vi.fn(() => null),
    nodeScreenRadius: vi.fn(() => null),
    nodeAt: vi.fn(() => null),
    groupAt: vi.fn(() => null),
    screenToWorld: vi.fn((x: number, y: number) => [x, y]),
    panBy: vi.fn(),
    resize: vi.fn(),
  };
  const simulation = {
    nodes: vi.fn(() => []),
    tick: vi.fn(),
    stop: vi.fn(),
    drag: vi.fn(),
    release: vi.fn(),
    shiftAnchors: vi.fn(),
  };
  return { renderer, simulation };
});

vi.mock('$lib/components/overview/graph/renderer', () => ({
  createRenderer: vi.fn(async () => graph.renderer),
  themeLabelColors: vi.fn(() => ({ primary: '#fff', secondary: '#aaa' })),
}));
vi.mock('$lib/components/overview/graph/simulation', () => ({
  createSimulation: vi.fn(() => graph.simulation),
}));

import ArchitectureGraph from './ArchitectureGraph.svelte';

function snapshot() {
  return {
    nodes: [
      {
        id: 'hub',
        name: 'Hub',
        kind: 'app',
        network: 'vercel',
        fn: 'app',
        x: 0,
        y: 0,
        icon: 'Globe',
        endpoints: [],
        description: 'Hub',
        status: 'ok',
        statusDetail: 'Serving this request.',
      },
    ],
    edges: [],
    c4: { nodes: [], relations: [], generatedFrom: 'source' },
    checkedAt: 1,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('mounts the production architecture controller and repairs a failed read with Retry', async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (fail) throw new Error('private provider detail');
      return new Response(JSON.stringify(snapshot()), { status: 200 });
    }),
  );
  const view = render(ArchitectureGraph, { actorId: 'actor', orgId: 'org' });
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.container.textContent).not.toContain('private provider detail');
  fail = false;
  await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
  expect(view.container.querySelector('canvas')).toBeTruthy();
  await waitFor(() => expect(graph.renderer.setGraph).toHaveBeenCalled());

  const topControls = view.getByTestId('architecture-top-controls');
  expect(topControls.querySelectorAll('button')).toHaveLength(4);
  expect(topControls.contains(view.getByRole('button', { name: 'Refresh' }))).toBe(true);
  const showKey = view.getByRole('button', { name: 'Show key' });
  expect(topControls.contains(showKey)).toBe(true);
  expect(
    [...topControls.querySelectorAll('[role="group"]')].some(
      (group) => group.querySelectorAll('button').length === 2,
    ),
  ).toBe(true);

  await fireEvent.click(showKey);
  const legend = topControls.querySelector('.arch-legend');
  const expandedKey = topControls.querySelector('.arch-legend-key');
  const viewControls = topControls.querySelector('.arch-view-controls');
  expect(legend?.contains(expandedKey)).toBe(true);
  expect(legend?.nextElementSibling).toBe(viewControls);

  const bottomControls = view.container.querySelector('.arch-bottom-controls');
  expect(bottomControls).toBeTruthy();
  expect(bottomControls?.querySelectorAll('button')).toHaveLength(4);
});
