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
    todo: 'bg-[#3b82f6]',
    in_progress: 'bg-status-thinking animate-[dot-pulse_0.8s_ease_infinite]',
    done: 'bg-status-running',
  };
</script>

<div
  class="bg-bg3 border border-border rounded-[5px] px-2 py-[7px] mb-[5px] text-[11px] cursor-grab transition-[border-color,opacity] duration-200 hover:border-accent active:cursor-grabbing active:opacity-70"
  draggable="true"
  ondragstart={onDragStart}
  role="listitem"
>
  <div class="flex items-center gap-[5px]">
    <span class="w-1.5 h-1.5 rounded-full shrink-0 {dotColor[task.status]}"></span>
    <span class="text-foreground font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">{task.title}</span>
  </div>
  {#if task.description}
    <div class="text-muted text-[10px] mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis">{task.description}</div>
  {/if}
</div>
