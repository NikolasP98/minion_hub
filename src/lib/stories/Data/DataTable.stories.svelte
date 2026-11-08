<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import DataTable, {
    type DataColumn,
    type DataCellContext,
  } from '$lib/components/data-table/DataTable.svelte';
  import { Badge, Button } from '$lib/components/ui';

  type Status = 'active' | 'paused' | 'archived';
  type Row = {
    id: string;
    code: string;
    name: string;
    status: Status;
    qty: number;
    amount: number;
    createdAt: string;
    active: boolean;
    note: string;
  };

  const NAMES = [
    'Oak',
    'Hydrating facial serum',
    'Quarterly maintenance contract for the north warehouse',
    'Pine',
    'Blue ceramic mug set (6 pieces)',
    'Consultation',
    'Stainless steel water bottle 750 ml with insulated double wall and bamboo lid',
    'Lamp',
  ];
  const STATUSES: Status[] = ['active', 'paused', 'archived'];
  const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));
  const STATUS_TONE = { active: 'success', paused: 'warning', archived: 'error' } as const;

  // Deterministic pseudo-random rows: varied string lengths, big numbers, dates.
  function makeRows(n: number): Row[] {
    return Array.from({ length: n }, (_, i) => {
      const seed = (i * 7919) % 1000;
      return {
        id: `row-${i + 1}`,
        code: `SKU-${String(i + 1).padStart(4, '0')}`,
        name: NAMES[i % NAMES.length],
        status: STATUSES[i % 3],
        qty: (seed * 13) % 5000,
        amount: Math.round(seed * 1234.567 * (i % 5 === 0 ? 100 : 1) * 100) / 100,
        createdAt: new Date(Date.UTC(2026, i % 12, (i % 27) + 1)).toISOString().slice(0, 10),
        active: i % 4 !== 0,
        note: i % 3 === 0 ? 'Needs review before the next stock count.' : '',
      };
    });
  }

  const rows = makeRows(12);
  const manyRows = makeRows(200);
  const openRow = fn();

  const columns: DataColumn<Row>[] = [
    { key: 'code', label: 'Code', width: 110 },
    { key: 'name', label: 'Name', fill: true, width: 220, editable: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: () => STATUS_OPTIONS,
      filter: { options: () => STATUS_OPTIONS },
      editable: true,
      width: 120,
    },
    { key: 'qty', label: 'Qty', type: 'number', align: 'right', editable: true, width: 90 },
    { key: 'amount', label: 'Amount', money: true, align: 'right', editable: true, width: 140 },
    { key: 'createdAt', label: 'Created', type: 'date', filter: { kind: 'date' }, width: 120 },
    { key: 'active', label: 'Active', type: 'boolean', editable: true, width: 80 },
    { key: 'note', label: 'Note', defaultHidden: true, width: 240 },
  ];

  const { Story } = defineMeta({
    title: 'Data/DataTable',
    component: DataTable,
    tags: ['autodocs'],
    argTypes: {
      variant: { control: 'select', options: ['full', 'plain'] },
      density: { control: 'select', options: ['compact', 'normal', 'comfortable'] },
      searchable: { control: 'boolean' },
      selectable: { control: 'boolean' },
      loading: { control: 'boolean' },
      canEdit: { control: 'boolean' },
      footer: { control: 'boolean' },
    },
    args: {
      data: rows,
      columns,
      getRowId: (row: Row) => row.id,
      height: '28rem',
      onRowClick: fn(),
      onSelectionChange: fn(),
      onSaveRow: fn(async () => true),
      onAdd: fn(),
    },
  });
</script>

<script lang="ts">
  let selectedIds = $state(new Set<string>());
  let groupValue = $state('status');
  const groupOptions = [
    { value: 'status', label: 'Status' },
    { value: 'active', label: 'Active' },
  ];
  const groupBy = $derived({
    of: (row: Row) => String(row[groupValue as 'status' | 'active']),
    label: (key: string, rs: Row[]) => `${key} · ${rs.length}`,
  });
</script>

<Story name="Basic">
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Plain" args={{ variant: 'plain', height: undefined }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="ManyRows" args={{ data: manyRows, ariaLabel: '200 rows, virtualized' }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Empty" args={{ data: [], emptyMessage: 'No items match this view yet.' }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Loading" args={{ data: [], loading: true, loadingRows: 8 }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story
  name="Error"
  args={{ data: [], error: new Error('Request timed out after 15 s'), onRetry: fn() }}
>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Searchable" args={{ searchable: true, search: 'mug', searchPlaceholder: 'Search items' }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Selectable" args={{ selectable: true }}>
  {#snippet template(args)}
    <p class="text-sm text-muted-foreground mb-2">Selected: {selectedIds.size}</p>
    <DataTable
      {...args}
      bind:selectedIds
      bulkActions={[
        { label: 'Archive', onSelect: fn() },
        { label: 'Delete', danger: true, onSelect: fn() },
      ]}
    />
  {/snippet}
</Story>

<Story name="Editable" args={{ canEdit: true }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="CellSelectCustomEdit" args={{ canEdit: true }}>
  {#snippet template(args)}
    <DataTable
      {...args}
      columns={[
        { key: 'name', label: 'Name', editable: true },
        { key: 'status', label: 'Status (custom cell)', custom: true, customEditable: true },
        { key: 'code', label: 'Read-only' },
      ]}
      {cell}
    />
  {/snippet}
</Story>

{#snippet cell(row: Row, column: DataColumn<Row>, context: DataCellContext)}
  {#if column.key === 'status'}
    {#if context.open}
      <Button variant="secondary" size="xs" onclick={() => context.onOpenChange?.(false)}>
        editing… close
      </Button>
    {:else}
      <Badge variant="semantic" size="sm" value={STATUS_TONE[row.status]}>{row.status}</Badge>
    {/if}
  {/if}
{/snippet}

<Story name="BadgeCells">
  {#snippet template(args)}
    <DataTable {...args} cells={{ status: statusCell }} />
  {/snippet}
</Story>

{#snippet statusCell(row: Row)}
  <Badge variant="semantic" size="sm" value={STATUS_TONE[row.status]}>{row.status}</Badge>
{/snippet}

<Story name="Grouped" args={{ groupNoneLabel: 'No grouping' }}>
  {#snippet template(args)}
    <DataTable
      {...args}
      {groupOptions}
      bind:groupValue
      groupBy={groupValue ? groupBy : undefined}
    />
  {/snippet}
</Story>

<Story name="Compact" args={{ density: 'compact', data: manyRows }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="Comfortable" args={{ density: 'comfortable' }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story
  name="FiltersAndFooter"
  args={{
    footer: true,
    initialAggregates: { qty: ['sum'], amount: ['sum', 'avg'] },
    filterChips: true,
    filters: { status: { kind: 'enum', values: ['active'] } },
    initialSort: { key: 'amount', dir: 'desc' },
  }}
>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="RowActions" args={{ rowActionsMode: 'always', rowActionsWidth: 96 }}>
  {#snippet template(args)}
    <DataTable {...args} {rowActions} />
  {/snippet}
</Story>

{#snippet rowActions(row: Row)}
  <Button variant="ghost" size="xs" onclick={() => openRow(row.id)}>Open</Button>
{/snippet}

<Story name="ExpandableRows" args={{ initialExpanded: ['row-1'] }}>
  {#snippet template(args)}
    <DataTable {...args} {expandedContent} />
  {/snippet}
</Story>

{#snippet expandedContent(row: Row)}
  <div class="p-3 text-sm text-muted-foreground">
    {row.note || 'No note for this row.'} Created {row.createdAt}.
  </div>
{/snippet}

<Story
  name="ServerMode"
  args={{
    data: manyRows.slice(0, 25),
    server: { total: 1240, pageSize: 25, onQuery: fn(), loading: false },
  }}
>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<!-- Responsive: the wrapper owns an overflow-x scroller; columns do not shrink below their widths. -->
<Story name="ManyRows · Phone" args={{ data: manyRows, ariaLabel: '200 rows, virtualized' }} globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>

<Story name="ManyRows · Tablet" args={{ data: manyRows, ariaLabel: '200 rows, virtualized' }} globals={{ viewport: { value: 'tablet', isRotated: false } }}>
  {#snippet template(args)}
    <DataTable {...args} />
  {/snippet}
</Story>
