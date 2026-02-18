<script lang="ts">
  import type { TaskData } from '$lib/state/missions.svelte';

  let { task }: { task: TaskData } = $props();

  function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/plain', task.id);
    e.dataTransfer!.effectAllowed = 'move';
  }
</script>

<div
  class="task-card"
  draggable="true"
  ondragstart={onDragStart}
  role="listitem"
>
  <div class="task-title-row">
    <span class="task-dot {task.status}"></span>
    <span class="task-title">{task.title}</span>
  </div>
  {#if task.description}
    <div class="task-desc">{task.description}</div>
  {/if}
</div>

<style>
  .task-card {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 7px 8px;
    margin-bottom: 5px;
    font-size: 11px;
    cursor: grab;
    transition: border-color 0.2s, opacity 0.2s;
  }
  .task-card:hover { border-color: var(--accent); }
  .task-card:active { cursor: grabbing; opacity: 0.7; }
  .task-title-row { display: flex; align-items: center; gap: 5px; }
  .task-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .task-dot.backlog     { background: var(--text3); }
  .task-dot.todo        { background: #3b82f6; }
  .task-dot.in_progress { background: var(--status-thinking); animation: dot-pulse 0.8s ease infinite; }
  .task-dot.done        { background: var(--status-running); }
  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
  .task-title {
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .task-desc {
    color: var(--text2);
    font-size: 10px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
