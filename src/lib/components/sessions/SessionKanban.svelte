<script lang="ts">
  import { Button } from '$lib/components/ui';
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import {
    sessionTasksState,
    loadSessionTasks,
    type SessionTaskData,
  } from '$lib/state/features/session-tasks.svelte';
  import { createViewPref } from '$lib/components/data-view/view-pref.svelte';
  import * as m from '$lib/paraglide/messages';
  import { toastError } from '$lib/state/ui/toast.svelte';

  let { sessionKey, serverId }: { sessionKey: string | null; serverId: string | null } = $props();

  type Status = SessionTaskData['status'];
  // `id`/`color` are what BoardView reads; the colour is the column's status dot.
  const cols = $derived([
    {
      id: 'backlog' as const,
      label: m.session_kanbanBacklog(),
      short: 'B',
      color: 'var(--color-muted-foreground)',
    },
    {
      id: 'todo' as const,
      label: m.session_kanbanTodo(),
      short: 'T',
      color: 'var(--color-accent)',
    },
    {
      id: 'in_progress' as const,
      label: m.session_kanbanInProgress(),
      short: 'P',
      color: 'var(--color-purple)',
    },
    {
      id: 'done' as const,
      label: m.session_kanbanDone(),
      short: 'D',
      color: 'var(--color-success)',
    },
  ]);
  const dotColor: Record<Status, string> = {
    backlog: 'bg-muted-foreground',
    todo: 'bg-[var(--color-accent)]',
    in_progress: 'bg-status-thinking animate-[dot-pulse_0.8s_ease_infinite]',
    done: 'bg-status-running',
  };

  const collapsedPref = createViewPref('kanban-collapsed', ['true', 'false'] as const, 'true');
  const collapsed = $derived(collapsedPref.value === 'true');
  const toggleCollapsed = () => collapsedPref.set(collapsed ? 'false' : 'true');

  $effect(() => {
    if (serverId && sessionKey) {
      loadSessionTasks(serverId, sessionKey);
    }
  });

  const allTasks = $derived(sessionKey ? (sessionTasksState.tasksBySession[sessionKey] ?? []) : []);

  function tasksForStatus(status: Status) {
    return allTasks.filter((t) => t.status === status);
  }

  const total = $derived(allTasks.length);
  const doneCount = $derived(tasksForStatus('done').length);
  const pct = $derived(total > 0 ? Math.round((doneCount / total) * 100) : 0);

  const colCounts = $derived(
    cols.map((c) => ({ short: c.short, count: tasksForStatus(c.id).length })),
  );

  /** One write per move, from the menu or a drop. `false` = refused (BoardView announces it). */
  async function moveTask(taskId: string, newStatus: Status): Promise<boolean> {
    if (!sessionKey) return false;
    const task = sessionTasksState.tasksBySession[sessionKey]?.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return false;

    // Optimistic update, snapshot so a failed PATCH can revert the column.
    const prevStatus = task.status;
    task.status = newStatus;

    // Persist to API
    if (serverId) {
      try {
        const res = await fetch(
          `/api/servers/${serverId}/sessions/${encodeURIComponent(sessionKey)}/tasks/${taskId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
        );
        if (!res.ok) throw new Error(`task update failed (${res.status})`);
      } catch {
        task.status = prevStatus;
        toastError('Failed to move task', 'The task status could not be updated.');
        return false;
      }
    }
    return true;
  }
</script>

<div class="shrink-0 border-b border-border bg-bg2">
  <!-- Collapsed header row -->
  <Button
    variant="ghost"
    class="!h-auto !w-full !justify-start gap-2 !px-2.5 !py-1.5 text-left"
    onclick={toggleCollapsed}
    aria-expanded={!collapsed}
    aria-controls="session-kanban-panel"
  >
    <!-- Chevron -->
    <span class="text-muted-foreground text-xs transition-transform {collapsed ? '' : 'rotate-90'}"
      >▸</span
    >

    <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >{m.session_kanbanTasks()}</span
    >

    {#if total > 0}
      <!-- Mini progress bar -->
      <div class="flex-1 h-[3px] bg-border rounded-full overflow-hidden mx-1">
        <div
          class="h-full bg-status-running rounded-full transition-[width] duration-[var(--duration-normal)]"
          style:width="{pct}%"
        ></div>
      </div>

      <!-- Column counts -->
      <div class="flex gap-1.5 text-xs text-muted-foreground tabular-nums">
        {#each colCounts as cc (cc.short)}
          <span>{cc.short}({cc.count})</span>
        {/each}
      </div>
    {:else}
      <span class="text-xs text-muted-strong ml-1">{m.session_kanbanNoTasks()}</span>
      <span class="flex-1"></span>
    {/if}
  </Button>

  <!-- Expanded body -->
  {#if !collapsed}
    <div id="session-kanban-panel">
      {#if total > 0}
        <div class="sk-board">
          <BoardView
            columns={cols}
            rows={allTasks}
            columnOf={(task) => task.status}
            rowKey={(task) => task.id}
            rowLabel={(task) => task.title}
            onmove={(task, columnId) => moveTask(task.id, columnId as Status)}
            fit
            unclassified={false}
          >
            {#snippet card(task)}
              <span class="flex items-center gap-[var(--space-1)]">
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {dotColor[task.status]}"></span>
                <span class="text-foreground font-medium truncate flex-1 min-w-0">{task.title}</span
                >
              </span>
              {#if task.description}
                <span class="sk-desc truncate">{task.description}</span>
              {/if}
            {/snippet}
          </BoardView>
        </div>
      {:else}
        <div class="px-3 py-3 text-xs text-muted-strong text-center">
          {m.session_kanbanNoTasksForSession()}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The board is a strip above the session monitor: columns scroll inside this cap. */
  .sk-board {
    display: flex;
    max-height: 15rem;
    padding: var(--space-3);
  }
  .sk-desc {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-telemetry);
  }
</style>
