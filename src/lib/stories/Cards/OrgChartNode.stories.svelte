<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import { SvelteFlow, type Edge, type Node } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import OrgChartNode from '$lib/components/workforce/OrgChartNode.svelte';

  // `Handle` needs a SvelteFlow instance in context, so every story renders a tiny flow.
  const nodeTypes = { org: OrgChartNode };
  type OrgNodeData = ComponentProps<typeof OrgChartNode>['data'];
  const node = (id: string, data: OrgNodeData, x = 0, y = 0): Node => ({
    id,
    type: 'org',
    position: { x, y },
    data,
  });
  const flow = (nodes: Node[], edges: Edge[] = []) => ({ nodes, edges });

  const root = {
    name: 'Nikolas Petrov',
    role: 'ceo',
    status: 'active',
    title: 'Founder',
    isRoot: true,
  };
  const agent = {
    name: 'Front desk agent',
    role: 'customer_support',
    status: 'running',
    adapterType: 'claude-code',
  };

  const { Story } = defineMeta({
    title: 'Components/Cards/OrgChartNode',
    component: OrgChartNode,
    tags: ['autodocs'],
  });
</script>

<Story name="Root">
  {#snippet template()}
    <div class="h-48 w-full"><SvelteFlow nodes={[node('r', root)]} {nodeTypes} fitView /></div>
  {/snippet}
</Story>

<Story name="Agent with adapter">
  {#snippet template()}
    <div class="h-48 w-full"><SvelteFlow nodes={[node('a', agent)]} {nodeTypes} fitView /></div>
  {/snippet}
</Story>

<Story name="Statuses">
  {#snippet template()}
    <div class="h-64 w-full">
      <SvelteFlow
        nodes={['active', 'running', 'paused', 'error', 'idle', 'unknown'].map((status, i) =>
          node(
            status,
            { ...agent, name: `Agent ${status}`, status },
            (i % 3) * 250,
            Math.floor(i / 3) * 120,
          ),
        )}
        {nodeTypes}
        fitView
      />
    </div>
  {/snippet}
</Story>

<Story name="Avatar (and fallback)">
  {#snippet template()}
    <div class="h-48 w-full">
      <SvelteFlow
        nodes={[
          node('ok', {
            ...agent,
            avatarUrl: 'https://api.dicebear.com/9.x/bottts/svg?seed=minion',
          }),
          node(
            'broken',
            { ...agent, name: 'Broken avatar', avatarUrl: 'https://invalid.local/x.png' },
            250,
          ),
        ]}
        {nodeTypes}
        fitView
      />
    </div>
  {/snippet}
</Story>

<Story name="Vertical tree">
  {#snippet template()}
    <div class="h-80 w-full">
      <SvelteFlow
        nodes={[
          node('r', root, 125, 0),
          node('a', agent, 0, 140),
          node('b', { ...agent, name: 'Billing agent', role: 'finance', status: 'idle' }, 250, 140),
        ]}
        edges={[
          { id: 'ra', source: 'r', target: 'a' },
          { id: 'rb', source: 'r', target: 'b' },
        ]}
        {nodeTypes}
        fitView
      />
    </div>
  {/snippet}
</Story>

<Story name="Horizontal tree">
  {#snippet template()}
    <div class="h-64 w-full">
      <SvelteFlow
        nodes={[
          node('r', { ...root, orientation: 'horizontal' }, 0, 60),
          node('a', { ...agent, orientation: 'horizontal' }, 300, 0),
          node(
            'b',
            { ...agent, name: 'Billing agent', role: 'finance', orientation: 'horizontal' },
            300,
            120,
          ),
        ]}
        edges={[
          { id: 'ra', source: 'r', target: 'a' },
          { id: 'rb', source: 'r', target: 'b' },
        ]}
        {nodeTypes}
        fitView
      />
    </div>
  {/snippet}
</Story>

<Story name="Long names">
  {#snippet template()}
    <div class="h-48 w-full">
      <SvelteFlow
        nodes={[
          node('l', {
            name: 'Maximiliano Alejandro de la Cruz Villanueva-Echeverría',
            role: 'chief_customer_experience_officer',
            status: 'active',
            adapterType: 'openai-codex-very-long-adapter-name',
          }),
        ]}
        {nodeTypes}
        fitView
      />
    </div>
  {/snippet}
</Story>
