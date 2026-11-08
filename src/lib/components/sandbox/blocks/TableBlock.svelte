<script lang="ts">
  /** Table block (spec 049): rows in the hub's DataTable, plain preset. */
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { formatDate } from '$lib/utils/format';
  import { DEFAULT_CURRENCY, formatValue } from '$lib/sandbox/blocks/format';
  import type { TableSpec } from '$lib/sandbox/blocks/schema';
  import type { QueryResult } from '../BlockView.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    spec: TableSpec;
    rows: QueryResult;
  }

  let { spec, rows }: Props = $props();

  type Row = Record<string, unknown> & { __id: string };

  const data = $derived<Row[]>(rows.rows.map((row, i) => ({ ...row, __id: String(i) })));

  type CellFormat = 'number' | 'compact' | 'money' | 'percent' | 'date' | 'text';
  function formatOf(name: string, type: string): CellFormat {
    const declared = spec.formats?.[name];
    if (declared) return declared;
    if (type === 'number') return 'number';
    if (type === 'timestamp') return 'date';
    return 'text';
  }

  const columns = $derived<DataColumn<Row>[]>(
    rows.columns.map((c) => {
      const format = formatOf(c.name, c.type);
      const numeric = format !== 'text' && format !== 'date';
      return {
        key: c.name,
        label: c.name.replace(/_/g, ' '),
        align: numeric ? 'right' : 'left',
        numeric,
        ...(format === 'money' ? { money: spec.currency ?? DEFAULT_CURRENCY } : {}),
        custom: true,
      };
    }),
  );

  function cellText(row: Row, column: DataColumn<Row>): string {
    const value = row[column.key];
    const format = formatOf(column.key, rows.columns.find((c) => c.name === column.key)?.type ?? '');
    if (value == null) return '—';
    if (format === 'date') return formatDate(String(value), { dateStyle: 'medium' });
    if (format === 'text') return String(value);
    return formatValue(value, format, spec.currency);
  }
</script>

{#snippet cell(row: Row, column: DataColumn<Row>)}
  <span class={column.align === 'right' ? 't-mono' : undefined}>{cellText(row, column)}</span>
{/snippet}

<div class="table-box">
  {#if data.length === 0}
    <p class="t-caption table-empty">{m.sandbox_block_empty()}</p>
  {:else}
    <DataTable variant="plain" {data} {columns} getRowId={(row) => row.__id} {cell} />
  {/if}
</div>

<style>
  .table-box {
    min-height: 0;
    flex: 1;
    overflow: auto;
  }
  .table-empty {
    padding: var(--space-4);
    color: var(--color-text-tertiary);
    text-align: center;
  }
</style>
