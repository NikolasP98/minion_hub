// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Agents from './AgentsGrid.svelte';
import Skills from './SkillsGrid.svelte';
import Tools from './ToolsGrid.svelte';
import Flows from '../../flow-editor/FlowGroupSection.svelte';
import Masters from '../../flow-editor/MasterFlowsSection.svelte';
import Workshop from '../../../../routes/(app)/agents/workshop/+page.svelte';
import {
  builderState,
  trace,
  resetTrace,
} from '../../../../../tests/fixtures/card-actions/state.svelte';

vi.mock(
  '$lib/state/builder',
  () => import('../../../../../tests/fixtures/card-actions/state.svelte'),
);
vi.mock(
  '$lib/state/workshop/workshop.svelte',
  () => import('../../../../../tests/fixtures/card-actions/state.svelte'),
);
vi.mock('$lib/navigation', () => import('../../../../../tests/fixtures/card-actions/navigation'));
vi.mock('$app/navigation', () => import('../../../../../tests/fixtures/card-actions/navigation'));

afterEach(() => {
  cleanup();
  resetTrace();
  builderState.agents[0].id = 'agent-a';
});

describe('native card action ownership', () => {
  for (const [label, component, record] of [
    ['agents', Agents, 'Reception assistant'],
    ['skills', Skills, 'Appointment follow-up'],
  ] as const) {
    it(`${label}: Delete is a named sibling and cannot invoke navigation`, async () => {
      const onDelete = vi.fn();
      const view = render(component, { onDelete });
      const action = view.getByRole('button', { name: `Delete ${record}` });
      expect(action.closest('a, [role="button"]')).toBeNull();
      expect(action.getAttribute('type')).toBe('button');
      expect(view.getByRole('link', { name: record })).toBeTruthy();
      await fireEvent.keyDown(action, { key: 'Enter' });
      await fireEvent.keyDown(action, { key: ' ' });
      expect(trace.events).toEqual([]);
      // DOM dispatch does not synthesize native activation. Real-browser evidence
      // covers that sequence; this click checks the mounted callback separately.
      await fireEvent.click(action);
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(trace.events).toEqual([]);
      expect(
        view.getAllByRole('button').map((node) => node.getAttribute('aria-label')),
      ).toHaveLength(2);
    });
  }

  it.each([true, false])('preserves custom/gateway tool permissions, admin=%s', async (isAdmin) => {
    const onDeleteCustom = vi.fn();
    const view = render(Tools, {
      isAdmin,
      onDeleteCustom,
      tools: [
        { id: 'custom', name: 'Custom lookup', description: '', source: 'custom' },
        {
          id: 'gateway',
          name: 'Gateway lookup',
          description: '',
          source: 'gateway',
          enabled: false,
        },
      ],
    });
    expect(view.getAllByRole('link')).toHaveLength(2);
    expect(view.queryByRole('button', { name: 'Delete Gateway lookup' })).toBeNull();
    const action = view.queryByRole('button', { name: 'Delete Custom lookup' });
    expect(Boolean(action)).toBe(isAdmin);
    if (action) {
      expect(action.closest('a, [role="button"]')).toBeNull();
      await fireEvent.click(action);
      expect(onDeleteCustom).toHaveBeenCalledExactlyOnceWith('custom', 'Custom lookup');
      expect(trace.events).toEqual([]);
    }
  });

  it('empty flow groups expose no fabricated navigation or deletion', () => {
    const view = render(Flows, {
      title: 'Empty flows',
      kind: 'my',
      flows: [],
      onDeleteFlow: vi.fn(),
    });
    expect(view.queryByRole('link')).toBeNull();
    expect(view.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('preserves flow collapse, deletion and independent native navigation', async () => {
    const onDeleteFlow = vi.fn();
    const flow = { id: 'flow-a', name: 'Reception flow', nodeCount: 2, updatedAt: 1 };
    const view = render(Flows, { title: 'My flows', kind: 'my', flows: [flow], onDeleteFlow });
    const action = view.getByRole('button', { name: 'Delete Reception flow' });
    expect(action.closest('a, [role="button"]')).toBeNull();
    expect(action.getAttribute('type')).toBe('button');
    await fireEvent.click(action);
    expect(onDeleteFlow).toHaveBeenCalledExactlyOnceWith(flow);
    expect(trace.events).toEqual([]);
    await fireEvent.click(view.getByRole('button', { name: /My flows/ }));
    expect(view.queryByRole('link')).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: /My flows/ }));
    expect(view.getByRole('link', { name: 'Reception flow' }).getAttribute('href')).toBe(
      '/flow-editor/flow-a',
    );
  });

  it('uses native master-flow links without imperative key handlers', async () => {
    const view = render(Masters);
    const links = view.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/flow-editor\/master\//);
      await fireEvent.keyDown(link, { key: ' ' });
    }
    expect(trace.events).toEqual([]);
  });

  it('workshop Delete cannot open; opening preserves open/persist/goto ordering', async () => {
    const view = render(Workshop);
    const action = await view.findByRole('button', { name: 'Delete Reception workspace' });
    expect(action.closest('a, [role="button"]')).toBeNull();
    expect(action.parentElement?.closest('button')).toBeNull();
    await fireEvent.click(action);
    await waitFor(() => expect(trace.events).toEqual(['delete:workspace-a']));
    resetTrace();
    const open = view.getByRole('button', { name: 'Stock workspace' });
    expect(open.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/);
    expect(open.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(open.querySelector('div, p, button, a')).toBeNull();
    await fireEvent.click(open);
    await waitFor(() =>
      expect(trace.events).toEqual([
        'open:workspace-b',
        'persist:workspace-b',
        'goto:/agents/workshop/workspace-b',
      ]),
    );
    for (const button of view.getAllByRole('button'))
      expect(button.getAttribute('type')).toBe('button');
  });

  it.each(['folder/record', 'literal%2F', 'two words', '東京/ñ', '.', '..', ''])(
    'renders safe record href for %j',
    async (id) => {
      builderState.agents[0].id = id;
      const view = render(Agents, { onDelete: vi.fn() });
      await tick();
      const link = view.queryByRole('link', { name: 'Reception assistant' });
      if (!id || id === '.' || id === '..') expect(link).toBeNull();
      else expect(link?.getAttribute('href')).toBe(`/agents/builder/${encodeURIComponent(id)}`);
    },
  );
});
