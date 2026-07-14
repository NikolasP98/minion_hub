<script lang="ts">
  export type KanbanTask = {
    id: string;
    title: string;
    description: string | null;
    status: 'backlog' | 'todo' | 'in_progress' | 'done';
  };

  let { task }: { task: KanbanTask } = $props();

  function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/plain', task.id);
    e.dataTransfer!.effectAllowed = 'move';
  }

  const dotColor: Record<KanbanTask['status'], string> = {
    backlog: 'bg-muted-foreground',
    todo: 'bg-[var(--color-accent)]',
    in_progress: 'bg-status-thinking animate-[dot-pulse_0.8s_ease_infinite]',
    done: 'bg-status-running',
  };
</script>

<div
  class="bg-bg3 border border-border rounded-[var(--radius-md)] px-2 py-[var(--space-2)] mb-[var(--space-1)] text-[length:var(--font-size-caption)] cursor-grab transition-[border-color,opacity] duration-[var(--duration-fast)] hover:border-accent active:cursor-grabbing active:opacity-70"
  draggable="true"
  ondragstart={onDragStart}
  role="listitem"
>
  <div class="flex items-center gap-[var(--space-1)]">
    <span class="w-1.5 h-1.5 rounded-full shrink-0 {dotColor[task.status]}"></span>
    <span
      class="text-foreground font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0"
      >{task.title}</span
    >
  </div>
  {#if task.description}
    <div
      class="text-muted text-[length:var(--font-size-telemetry)] mt-[var(--space-0-5)] whitespace-nowrap overflow-hidden text-ellipsis"
    >
      {task.description}
    </div>
  {/if}
</div>
