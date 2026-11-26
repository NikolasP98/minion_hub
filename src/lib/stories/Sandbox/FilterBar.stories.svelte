<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import FilterBar from '$lib/components/sandbox/FilterBar.svelte';
  import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
  import type { BlockSpec, PageValue } from '$lib/sandbox/blocks/schema';

  const row = (
    id: string,
    position: number,
    title: string,
    spec: unknown,
  ): SandboxElementRecord => ({
    id,
    page: 'default',
    title,
    html: '',
    css: '',
    js: '',
    spec: spec as BlockSpec,
    w: 1,
    h: 1,
    position,
    createdBy: 'story',
    updatedAt: '2026-11-25T00:00:00.000Z',
    published: false,
    mine: true,
  });

  const date = row('f-date', 0, 'Period', {
    v: 1,
    type: 'filter',
    var: 'period',
    control: 'date_range',
  });
  const single = row('f-one', 1, 'Service', {
    v: 1,
    type: 'filter',
    var: 'service',
    control: 'select',
    options: { dataset: 'pos.ticket_lines', col: 'product_name' },
  });
  const multi = row('f-many', 2, 'Status', {
    v: 1,
    type: 'filter',
    var: 'status',
    control: 'multi_select',
    options: { dataset: 'pos.tickets', col: 'status' },
  });

  const { Story } = defineMeta({
    title: 'Sandbox/FilterBar',
    component: FilterBar,
    tags: ['autodocs'],
    parameters: { layout: 'padded' },
  });

  const host = createSandboxHost();
  const none = () => null;
</script>

<script lang="ts">
  // The picker choices come from /api/sandbox/query; in Storybook that call fails and the
  // pickers show their calm "could not load" note, which is itself a state worth gating.
  let values = $state<Record<string, PageValue | null>>({
    period: { kind: 'date', range: 'last_30d' },
  });
  const read = (name: string) => values[name] ?? null;
  const change = (name: string, value: PageValue | null) => (values[name] = value);
</script>

<Story name="Date filter set">
  {#snippet template()}
    <FilterBar filters={[date]} {host} {read} onchange={change} />
  {/snippet}
</Story>

<Story name="Date filter empty">
  {#snippet template()}
    <FilterBar filters={[date]} {host} read={none} onchange={change} />
  {/snippet}
</Story>

<Story name="Date, single and multi">
  {#snippet template()}
    <FilterBar filters={[date, single, multi]} {host} {read} onchange={change} />
  {/snippet}
</Story>

<Story name="Pickers without choices">
  {#snippet template()}
    <FilterBar filters={[single, multi]} {host} read={none} onchange={change} />
  {/snippet}
</Story>
