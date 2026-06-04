<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { DatabaseNodeData, DatabaseAction } from '$lib/state/features/flow-editor.svelte';

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
    <span class="text-[11px] font-medium text-foreground">Action</span>
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
        ? 'Read runs a SELECT (read-only) and returns the rows as JSON.'
        : 'Create / Update / Delete run a write statement and return the change count.'}
    </p>
  </div>

  <div class="flex flex-col gap-1">
    <label for="db-sql" class="text-[11px] font-medium text-foreground">SQL</label>
    <textarea
      id="db-sql"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-20 font-mono"
      placeholder={PLACEHOLDERS[action]}
      value={data.sql ?? ''}
      oninput={(e) => set({ sql: (e.target as HTMLTextAreaElement).value })}
    ></textarea>
    <p class="text-[10px] text-muted leading-snug">
      <code>{'{input}'}</code> expands to the upstream message.
      {#if isRead}Read enforces SELECT/WITH only.{/if}
    </p>
  </div>

  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">DB path (blank = message ledger)</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
      placeholder="~/.minion/message-ledger.db"
      value={data.dbPath ?? ''}
      oninput={(e) => set({ dbPath: (e.target as HTMLInputElement).value || undefined })}
    />
    <p class="text-[10px] text-muted leading-snug">Confined to the ledger or a file under the gateway state dir.</p>
  </label>

  {#if isRead}
    <details class="text-[11px]">
      <summary class="cursor-pointer text-muted hover:text-foreground">Consume-marker (optional)</summary>
      <p class="text-[10px] text-muted leading-snug mt-1.5 mb-2">
        Stamp a column on the rows this read returns, so each run drains only new rows
        (e.g. <code>last_checked</code> on the ledger). Identifiers are allow-listed.
      </p>
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">Marker column</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder="last_checked"
            value={data.markColumn ?? ''}
            oninput={(e) => set({ markColumn: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">Table</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder="messages"
            value={data.markTable ?? ''}
            oninput={(e) => set({ markTable: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-medium text-foreground">Row id column</span>
          <input
            class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder="id"
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
      placeholder="Database"
      value={data.label ?? ''}
      oninput={(e) => set({ label: (e.target as HTMLInputElement).value })}
    />
  </label>
</div>
