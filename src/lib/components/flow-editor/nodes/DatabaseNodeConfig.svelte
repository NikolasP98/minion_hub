<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { DatabaseNodeData, DatabaseAction } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as DatabaseNodeData);
  const action = $derived((data.action ?? 'read') as DatabaseAction);
  const isRead = $derived(action === 'read');

  const PLACEHOLDERS: Record<DatabaseAction, string> = {
    read: 'SELECT id, content FROM messages WHERE last_checked IS NULL',
    create: "INSERT INTO log (msg) VALUES ('{input}')",
    update: 'UPDATE messages SET last_checked = 1 WHERE last_checked IS NULL',
    delete: 'DELETE FROM log WHERE created_at < ...',
  };

  function set(patch: Partial<DatabaseNodeData>) {
    updateNodeData(nodeId, patch as Record<string, unknown>);
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">{m.flowcfg_dbAction()}</span>
    <div class="grid grid-cols-4 gap-1">
      {#each (['read', 'create', 'update', 'delete'] as const) as a (a)}
        <button
          type="button"
          class="px-1.5 py-1 rounded border text-[10px] capitalize transition-colors
            {action === a
              ? 'border-teal-400 bg-teal-500/15 text-foreground'
              : 'border-border bg-bg3 text-muted hover:border-border/80'}"
          onclick={() => set({ action: a })}
        >
          {a}
        </button>
      {/each}
    </div>
    <p class="text-[10px] text-muted leading-snug">
      {isRead
        ? m.flowcfg_readActionDesc()
        : m.flowcfg_writeActionDesc()}
    </p>
  </div>

  <div class="flex flex-col gap-1">
    <label for="db-sql" class="text-[11px] font-medium text-foreground">{m.flowcfg_sql()}</label>
    <textarea
      id="db-sql"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-20 font-mono"
      placeholder={PLACEHOLDERS[action]}
      value={data.sql ?? ''}
      oninput={(e) => set({ sql: (e.target as HTMLTextAreaElement).value })}
    ></textarea>
    <p class="text-[10px] text-muted leading-snug">
      <code>{'{input}'}</code> {m.flowcfg_inputExpands()}.
      {#if isRead}{m.flowcfg_readEnforceSelect()}{/if}
    </p>
  </div>

  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">{m.flowcfg_dbPathLabel()}</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
      placeholder={m.flowcfg_dbPathPlaceholder()}
      value={data.dbPath ?? ''}
      oninput={(e) => set({ dbPath: (e.target as HTMLInputElement).value || undefined })}
    />
    <p class="text-[10px] text-muted leading-snug">{m.flowcfg_dbPathConfined()}</p>
  </label>

  {#if isRead}
    <details class="text-[11px]">
      <summary class="cursor-pointer text-muted hover:text-foreground">{m.flowcfg_consumeMarkerOptional()}</summary>
      <p class="text-[10px] text-muted leading-snug mt-1.5 mb-2">
        {m.flowcfg_consumeMarkerDesc()}
      </p>
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">{m.flowcfg_markerColumnLabel()}</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder={m.flowcfg_markerColumnPlaceholder()}
            value={data.markColumn ?? ''}
            oninput={(e) => set({ markColumn: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">{m.flowcfg_tableLabel()}</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder={m.flowcfg_tableNamePlaceholder()}
            value={data.markTable ?? ''}
            oninput={(e) => set({ markTable: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">{m.flowcfg_idColumnLabel()}</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder={m.flowcfg_idColumnPlaceholder()}
            value={data.markIdColumn ?? ''}
            oninput={(e) => set({ markIdColumn: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>
      </div>
    </details>
  {/if}

  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Label</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_database()}
      value={data.label ?? ''}
      oninput={(e) => set({ label: (e.target as HTMLInputElement).value })}
    />
  </label>
</div>
