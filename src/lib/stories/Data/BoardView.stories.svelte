<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import BoardView from '$lib/components/data-view/BoardView.svelte';

  type Row = { id: string; title: string; client: string; stage: string | null; amount: number };

  const columns = [
    { id: 'new', label: 'New' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'proposal', label: 'Proposal sent', color: 'var(--color-accent)' },
    { id: 'won', label: 'Won', color: 'var(--color-success)' },
    { id: 'lost', label: 'Lost (including the ones that never replied)', color: 'var(--color-destructive)' },
  ];

  const rows: Row[] = [
    { id: '1', title: 'Website redesign', client: 'Garcia Studio', stage: 'new', amount: 4800 },
    { id: '2', title: 'Quarterly SEO retainer', client: 'Northwind', stage: 'new', amount: 1200 },
    { id: '3', title: 'Brand guidelines', client: 'Lumen', stage: 'contacted', amount: 2300 },
    {
      id: '4',
      title: 'Full ERP migration for three warehouses and the retail counter',
      client: 'Andes Logistics',
      stage: 'proposal',
      amount: 125000.5,
    },
    { id: '5', title: 'Logo', client: 'Pine', stage: 'won', amount: 350 },
    { id: '6', title: 'Landing page', client: 'Oak & Co', stage: 'won', amount: 1950 },
    { id: '7', title: 'App prototype', client: 'Velo', stage: 'lost', amount: 9800 },
    { id: '8', title: 'Unassigned lead', client: 'Unknown', stage: null, amount: 0 },
    { id: '9', title: 'Another lead without a stage', client: 'Mystery', stage: null, amount: 75 },
  ];

  const { Story } = defineMeta({
    title: 'Components/Data/BoardView',
    component: BoardView<Row>,
    tags: ['autodocs'],
    args: {
      columns,
      rows,
      columnOf: (row: Row) => row.stage,
      rowKey: (row: Row) => row.id,
      rowLabel: (row: Row) => row.title,
      onopen: fn(),
      emptyMessage: undefined,
    },
  });
</script>

<script lang="ts">
  let live = $state<Row[]>(structuredClone(rows));
</script>

{#snippet card(row: Row)}
  <div class="flex flex-col gap-1">
    <span class="text-sm font-medium">{row.title}</span>
    <span class="text-xs text-muted-foreground">{row.client}</span>
    <span class="text-xs tabular-nums">{row.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
  </div>
{/snippet}

<Story name="Populated">
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<Story name="Empty" args={{ rows: [], emptyMessage: 'No deals in this pipeline yet.' }}>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<Story name="Movable" args={{ onmove: fn() }}>
  {#snippet template(args)}
    <div style="height: 28rem">
      <BoardView
        {...args}
        rows={live}
        {card}
        onmove={(row, columnId) => {
          live = live.map((r) => (r.id === row.id ? { ...r, stage: columnId } : r));
          return true;
        }}
      />
    </div>
  {/snippet}
</Story>

<Story name="MoveRefused" args={{ onmove: fn(async () => false) }}>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<Story
  name="WithContextActions"
  args={{
    contextActions: (row: Row) => [
      { id: 'open', label: `Open ${row.title}`, run: fn() },
      { id: 'archive', label: 'Archive', danger: true, run: fn() },
    ],
  }}
>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<Story name="ManyCards" args={{ rows: Array.from({ length: 120 }, (_, i) => ({ ...rows[i % rows.length], id: `m${i}` })) }}>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<!-- Responsive: the board scrolls horizontally inside its host instead of widening the page. -->
<Story name="Populated · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>

<Story name="ManyCards · Tablet" args={{ rows: Array.from({ length: 120 }, (_, i) => ({ ...rows[i % rows.length], id: `m${i}` })) }} globals={{ viewport: { value: 'tablet', isRotated: false } }}>
  {#snippet template(args)}
    <div style="height: 28rem"><BoardView {...args} {card} /></div>
  {/snippet}
</Story>
