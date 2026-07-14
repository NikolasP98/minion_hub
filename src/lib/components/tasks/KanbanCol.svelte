<script lang="ts">
  import TaskCard from './TaskCard.svelte';
  import type { KanbanTask } from './TaskCard.svelte';

  let {
    status,
    label,
    tasks,
    onDropTask,
  }: {
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
    backlog:
      'text-muted-foreground bg-[color-mix(in srgb, var(--color-muted-foreground) 4%, transparent)]',
    todo: 'text-[var(--color-accent)] bg-[color-mix(in srgb, var(--color-accent) 4%, transparent)]',
    in_progress:
      'text-status-thinking bg-[color-mix(in srgb, var(--color-purple) 4%, transparent)]',
    done: 'text-status-running bg-[color-mix(in srgb, var(--color-success) 4%, transparent)]',
  };
</script>

<div class="border-r border-border last:border-r-0">
  <div
    class="px-[var(--space-2)] py-1.5 text-[length:var(--font-size-telemetry)] font-bold uppercase tracking-wide border-b border-border flex justify-between items-center {headerStyle[
      status
    ]}"
  >
    <span>{label}</span>
    <span class="text-[length:var(--font-size-telemetry)] font-normal opacity-65"
      >{tasks.length}</span
    >
  </div>
  <div
    role="list"
    class="p-1.5 min-h-[50px] max-h-[190px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]"
    ondragover={handleDragOver}
    ondrop={handleDrop}
  >
    {#if tasks.length === 0}
      <div
        class="text-muted-foreground text-[length:var(--font-size-telemetry)] text-center px-1 py-[var(--space-2)] opacity-50"
      >
        —
      </div>
    {:else}
      {#each tasks as task (task.id)}
        <TaskCard {task} />
      {/each}
    {/if}
  </div>
</div>
