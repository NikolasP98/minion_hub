<script lang="ts">
  import TaskCard from './TaskCard.svelte';
  import type { KanbanTask } from './TaskCard.svelte';

  let { status, label, tasks, onDropTask }: {
    status: 'backlog' | 'todo' | 'in_progress' | 'done';
    label: string;
    tasks: KanbanTask[];
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

  const headerStyle: Record<string, string> = {
    backlog: 'text-muted-foreground bg-[rgba(100,116,139,0.04)]',
    todo: 'text-[#3b82f6] bg-[rgba(59,130,246,0.04)]',
    in_progress: 'text-status-thinking bg-[rgba(168,85,247,0.04)]',
    done: 'text-status-running bg-[rgba(34,197,94,0.04)]',
  };
</script>

<div class="border-r border-border last:border-r-0">
  <div class="px-[10px] py-1.5 text-[10px] font-bold uppercase tracking-wide border-b border-border flex justify-between items-center {headerStyle[status]}">
    <span>{label}</span>
    <span class="text-[10px] font-normal opacity-65">{tasks.length}</span>
  </div>
  <div role="list" class="p-1.5 min-h-[50px] max-h-[190px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]" ondragover={handleDragOver} ondrop={handleDrop}>
    {#if tasks.length === 0}
      <div class="text-muted-foreground text-[10px] text-center px-1 py-[10px] opacity-50">—</div>
    {:else}
      {#each tasks as task (task.id)}
        <TaskCard {task} />
      {/each}
    {/if}
  </div>
</div>
