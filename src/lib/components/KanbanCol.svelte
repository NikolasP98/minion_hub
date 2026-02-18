<script lang="ts">
  import TaskCard from './TaskCard.svelte';
  import type { TaskData } from '$lib/state/missions.svelte';

  let { status, label, tasks, onDropTask }: {
    status: 'backlog' | 'todo' | 'in_progress' | 'done';
    label: string;
    tasks: TaskData[];
    onDropTask: (taskId: string) => void;
  } = $props();

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer?.getData('text/plain');
    if (taskId) onDropTask(taskId);
  }
</script>

<div class="kanban-col">
  <div class="col-header {status}">
    <span>{label}</span>
    <span class="kcount">{tasks.length}</span>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="col-body" ondragover={handleDragOver} ondrop={handleDrop}>
    {#if tasks.length === 0}
      <div class="col-empty">—</div>
    {:else}
      {#each tasks as task (task.id)}
        <TaskCard {task} />
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
  .col-header.backlog     { color: var(--text3);            background: rgba(100,116,139,0.04); }
  .col-header.todo        { color: #3b82f6;                 background: rgba(59,130,246,0.04); }
  .col-header.in_progress { color: var(--status-thinking);  background: rgba(168,85,247,0.04); }
  .col-header.done        { color: var(--status-running);   background: rgba(34,197,94,0.04); }
  .kcount { font-size: 10px; font-weight: 400; opacity: 0.65; }
  .col-body {
    padding: 6px; min-height: 50px; max-height: 190px;
    overflow-y: auto; scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .col-empty { color: var(--text3); font-size: 10px; text-align: center; padding: 10px 4px; opacity: 0.5; }
</style>
