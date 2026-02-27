<script lang="ts">
  import KanbanCol from './KanbanCol.svelte';
  import type { KanbanTask } from './TaskCard.svelte';
  import { sessionTasksState, loadSessionTasks } from '$lib/state/session-tasks.svelte';

  let { sessionKey, serverId }: { sessionKey: string | null; serverId: string | null } = $props();

  const cols = [
    { key: 'backlog' as const, label: 'Backlog', short: 'B' },
    { key: 'todo' as const, label: 'Todo', short: 'T' },
    { key: 'in_progress' as const, label: 'In Progress', short: 'P' },
    { key: 'done' as const, label: 'Done', short: 'D' },
  ];

  let collapsed = $state(sessionTasksState.kanbanCollapsed);

  function toggleCollapsed() {
    collapsed = !collapsed;
    sessionTasksState.kanbanCollapsed = collapsed;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kanban-collapsed', String(collapsed));
    }
  }

  $effect(() => {
    if (serverId && sessionKey) {
      loadSessionTasks(serverId, sessionKey);
    }
  });

  const allTasks = $derived(
    (sessionKey ? (sessionTasksState.tasksBySession[sessionKey] ?? []) : []) as KanbanTask[],
  );

  function tasksForStatus(status: KanbanTask['status']) {
    return allTasks.filter((t) => t.status === status);
  }

  const total = $derived(allTasks.length);
  const doneCount = $derived(tasksForStatus('done').length);
  const pct = $derived(total > 0 ? Math.round((doneCount / total) * 100) : 0);

  const colCounts = $derived(
    cols.map((c) => ({ short: c.short, count: tasksForStatus(c.key).length })),
  );

  async function moveTask(taskId: string, newStatus: KanbanTask['status']) {
    if (!sessionKey) return;
    // Optimistic update
    const tasks = sessionTasksState.tasksBySession[sessionKey];
    if (tasks) {
      const task = (tasks as KanbanTask[]).find((t) => t.id === taskId);
      if (task) task.status = newStatus;
    }

    // Persist to API
    if (serverId) {
      try {
        await fetch(
          `/api/servers/${serverId}/sessions/${encodeURIComponent(sessionKey)}/tasks/${taskId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
        );
      } catch {
        /* revert could be added here */
      }
    }
  }
</script>

<div class="shrink-0 border-b border-border bg-bg2">
  <!-- Collapsed header row -->
  <button
    class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-bg2 transition-colors"
    onclick={toggleCollapsed}
  >
    <!-- Chevron -->
    <span
      class="text-muted-foreground text-[10px] transition-transform {collapsed ? '' : 'rotate-90'}"
      >&#9654;</span
    >

    <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >Tasks</span
    >

    {#if total > 0}
      <!-- Mini progress bar -->
      <div class="flex-1 h-[3px] bg-border rounded-full overflow-hidden mx-1">
        <div
          class="h-full bg-status-running rounded-full transition-[width] duration-300"
          style:width="{pct}%"
        ></div>
      </div>

      <!-- Column counts -->
      <div class="flex gap-1.5 text-[10px] text-muted-foreground tabular-nums">
        {#each colCounts as cc (cc.short)}
          <span>{cc.short}({cc.count})</span>
        {/each}
      </div>
    {:else}
      <span class="text-[10px] text-muted-foreground/40 ml-1">— no tasks</span>
      <span class="flex-1"></span>
    {/if}
  </button>

  <!-- Expanded body -->
  {#if !collapsed}
    {#if total > 0}
      <div class="grid grid-cols-4">
        {#each cols as col (col.key)}
          <KanbanCol
            status={col.key}
            label={col.label}
            tasks={tasksForStatus(col.key)}
            onDropTask={(taskId) => moveTask(taskId, col.key)}
          />
        {/each}
      </div>
    {:else}
      <div class="px-3 py-3 text-[11px] text-muted-foreground/40 text-center">
        No tasks for this session.
      </div>
    {/if}
  {/if}
</div>
