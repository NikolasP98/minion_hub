<script lang="ts">
  import SessionCard from './SessionCard.svelte';

  let { status, label, sessions }: {
    status: 'running' | 'thinking' | 'idle' | 'aborted';
    label: string;
    sessions: unknown[];
  } = $props();
</script>

<div class="kanban-col">
  <div class="col-header {status}">
    <span>{label}</span>
    <span class="kcount">{sessions.length}</span>
  </div>
  <div class="col-body">
    {#if sessions.length === 0}
      <div class="col-empty">—</div>
    {:else}
      {#each sessions as session ((session as { sessionKey?: string }).sessionKey)}
        <SessionCard {session} {status} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .kanban-col {
    border-right: 1px solid var(--border);
  }
  .kanban-col:last-child { border-right: none; }
  .col-header {
    padding: 6px 10px;
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.6px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .col-header.running  { color: var(--status-running);  background: rgba(34,197,94,0.04); }
  .col-header.thinking { color: var(--status-thinking); background: rgba(168,85,247,0.04); }
  .col-header.idle     { color: var(--status-idle);     background: rgba(100,116,139,0.04); }
  .col-header.aborted  { color: var(--status-aborted);  background: rgba(245,158,11,0.04); }
  .kcount { font-size: 10px; font-weight: 400; opacity: 0.65; }
  .col-body {
    padding: 6px; min-height: 50px; max-height: 190px;
    overflow-y: auto; scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .col-empty { color: var(--text3); font-size: 10px; text-align: center; padding: 10px 4px; opacity: 0.5; }
</style>
