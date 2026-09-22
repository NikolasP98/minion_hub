<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { invalidate } from '$lib/navigation';
  import { Table2 } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { TABLE_REGISTRY, MODULE_LABELS } from '$lib/tables/defs';
  import { resolveTable, type TableConfig, type TableDef } from '$lib/tables/registry';
  import { tableConfig } from '$lib/tables/config.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  /**
   * /settings/tables — every registered table, its ID prefix and its fields,
   * edited IN a table: the prefix is a cell, each table expands to its fields
   * (label override, default visibility, editing switched off), and the fill
   * handle bulk-edits down a column. Saves go through PUT /api/tables/config
   * and the app layout's `tableConfig` is re-read, so every table on the next
   * page already wears the change.
   */
  type TableRow = {
    id: string;
    module: string;
    label: string;
    prefix: string;
    hasId: boolean;
    fields: number;
    customised: number;
  };
  type FieldRow = {
    id: string;
    tableId: string;
    key: string;
    label: string;
    custom: string;
    visible: boolean;
    editable: boolean;
    codeEditable: boolean;
  };

  const cfg = $derived(tableConfig());
  const moduleLabel = (id: string) => MODULE_LABELS[id]?.() ?? id;

  const rows = $derived(
    TABLE_REGISTRY.map((def): TableRow => {
      const r = resolveTable(def, cfg);
      const entry = cfg[def.id];
      return {
        id: def.id,
        module: def.module,
        label: def.label(),
        prefix: r.idPrefix,
        hasId: def.hasId,
        fields: def.fields.length,
        customised:
          (entry?.idPrefix !== undefined ? 1 : 0) + Object.keys(entry?.fields ?? {}).length,
      };
    }),
  );

  function fieldRows(def: TableDef): FieldRow[] {
    const r = resolveTable(def, cfg);
    const entry = cfg[def.id];
    return def.fields.map((f) => {
      const res = r.fields.get(f.key)!;
      return {
        id: `${def.id}:${f.key}`,
        tableId: def.id,
        key: f.key,
        label: f.label(),
        custom: entry?.fields?.[f.key]?.label ?? '',
        visible: res.hidden !== true,
        editable: !!f.editable && res.editable,
        codeEditable: !!f.editable,
      };
    });
  }

  const columns: DataColumn<TableRow>[] = [
    {
      key: 'module',
      label: m.settings_tables_col_module(),
      accessor: (r) => moduleLabel(r.module),
      width: 140,
      filter: {
        options: () =>
          [...new Set(TABLE_REGISTRY.map((t) => t.module))].map((v) => ({
            value: v,
            label: moduleLabel(v),
          })),
        match: (r) => r.module,
      },
    },
    { key: 'label', label: m.settings_tables_col_table(), accessor: (r) => r.label },
    {
      key: 'prefix',
      label: m.settings_tables_col_prefix(),
      editable: true,
      type: 'text',
      custom: true,
      accessor: (r) => r.prefix,
      width: 140,
    },
    {
      key: 'fields',
      label: m.settings_tables_col_fields(),
      align: 'right',
      numeric: true,
      accessor: (r) => r.fields,
      width: 100,
    },
    {
      key: 'customised',
      label: m.settings_tables_col_customised(),
      align: 'right',
      numeric: true,
      accessor: (r) => r.customised,
      width: 120,
    },
  ];

  const fieldColumns: DataColumn<FieldRow>[] = [
    { key: 'key', label: m.settings_tables_field(), accessor: (r) => r.key, cellClass: 'dt-mono' },
    { key: 'label', label: m.settings_tables_default_label(), accessor: (r) => r.label },
    {
      key: 'custom',
      label: m.settings_tables_custom_label(),
      editable: true,
      type: 'text',
      accessor: (r) => r.custom,
    },
    {
      key: 'visible',
      label: m.settings_tables_visible(),
      editable: true,
      type: 'boolean',
      accessor: (r) => r.visible,
      width: 150,
    },
    {
      key: 'editable',
      label: m.settings_tables_editable(),
      editable: true,
      type: 'boolean',
      custom: true,
      accessor: (r) => r.editable,
      width: 170,
    },
  ];

  async function put(patch: TableConfig): Promise<boolean> {
    const res = await fetch('/api/tables/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toastError(m.settings_tables_save_failed());
      return false;
    }
    await invalidate('app:table-config');
    return true;
  }

  const saveTable = (row: TableRow, draft: Record<string, string>) =>
    put({ [row.id]: { idPrefix: draft.prefix ?? row.prefix } });

  const saveField = (row: FieldRow, draft: Record<string, string>) =>
    put({
      [row.tableId]: {
        fields: {
          [row.key]: {
            label: draft.custom ?? row.custom,
            hidden: (draft.visible ?? String(row.visible)) === 'false',
            editable: (draft.editable ?? String(row.editable)) === 'true',
          },
        },
      },
    });

  async function reset(def: TableDef) {
    const ok = await put({
      [def.id]: {
        idPrefix: def.idPrefix,
        fields: Object.fromEntries(
          def.fields.map((f) => [f.key, { label: '', hidden: null, editable: true }]),
        ),
      },
    });
    if (ok) toastSuccess(m.settings_tables_reset_done());
  }
</script>

<svelte:head><title>{m.settings_tables_title()} — {m.nav_settings()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.settings_tables_title()} subtitle={m.settings_tables_subtitle()}>
    {#snippet leading()}<span class="lead-ico"><Table2 /></span>{/snippet}
  </PageHeader>
  <div class="flex-1 min-h-0 p-4 tables-page">
    <DataTable
      data={rows}
      {columns}
      getRowId={(r) => r.id}
      storageKey="settings-tables"
      searchable={false}
      onSaveRow={saveTable}
      expandedContent={fields}
      initialExpanded={[]}
    >
      {#snippet cell(row: TableRow, col: DataColumn<TableRow>)}
        {#if col.key === 'prefix'}
          {#if row.hasId}
            <span class="dt-mono">{row.prefix || '—'}</span>
          {:else}
            <span class="t-caption no-id" title={m.settings_tables_no_id_hint()}
              >{m.settings_tables_no_id()}</span
            >
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  </div>
</div>

{#snippet fields(row: TableRow)}
  {@const def = TABLE_REGISTRY.find((t) => t.id === row.id)!}
  <div class="fields-pane">
    <div class="fields-head">
      <span class="t-caption">{m.settings_tables_count_fields({ count: def.fields.length })}</span>
      <Button variant="ghost" size="xs" class="reset-btn" onclick={() => reset(def)}
        >{m.settings_tables_reset()}</Button
      >
    </div>
    <DataTable
      variant="plain"
      data={fieldRows(def)}
      columns={fieldColumns}
      getRowId={(r) => r.id}
      onSaveRow={saveField}
    >
      {#snippet cell(f: FieldRow, col: DataColumn<FieldRow>)}
        {#if col.key === 'editable'}
          {#if f.codeEditable}
            <span class="dt-bool" class:on={f.editable} aria-label={String(f.editable)}></span>
          {:else}
            <span class="t-caption no-id" title={m.settings_tables_not_editable_hint()}>—</span>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  </div>
{/snippet}

<style>
  .lead-ico {
    display: inline-flex;
    color: var(--color-accent);
    flex-shrink: 0;
  }
  .lead-ico :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .tables-page :global(.dt-mono) {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
  }
  .no-id {
    color: var(--color-text-tertiary);
  }
  .fields-pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    background: var(--color-surface-2);
  }
  .fields-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .fields-head :global(.reset-btn) {
    height: auto;
    min-height: 0;
    padding: 0;
    color: var(--color-accent);
  }
  /* Mirror DataTable's boolean mark for the custom "editable" cell. */
  .fields-pane :global(.dt-bool) {
    display: inline-flex;
    width: 1rem;
    height: 1rem;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    vertical-align: middle;
  }
  .fields-pane :global(.dt-bool.on) {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
</style>
