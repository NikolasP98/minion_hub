<script lang="ts">
  import KanbanCol from './KanbanCol.svelte';
  import { missionsState, type TaskData } from '$lib/state/missions.svelte';

  let { missionId, serverId }: { missionId: string; serverId: string | null } = $props();

  const allTasks = $derived(missionsState.tasksByMission[missionId] ?? []);

  function tasksForStatus(status: TaskData['status']) {
    return allTasks.filter((t) => t.status === status);
  }

  async function moveTask(taskId: string, newStatus: TaskData['status']) {
    // Optimistic update
    const tasks = missionsState.tasksByMission[missionId];
    if (tasks) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) task.status = newStatus;
    }

    // Persist to API
    if (serverId) {
      try {
        await fetch(`/api/servers/${serverId}/missions/${missionId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch { /* revert could be added here */ }
    }
  }

  const cols = [
    { key: 'backlog' as const, label: 'Backlog' },
    { key: 'todo' as const, label: 'Todo' },
    { key: 'in_progress' as const, label: 'In Progress' },
    { key: 'done' as const, label: 'Done' },
  ];
</script>

<div class="kanban">
  {#each cols as col (col.key)}
    <KanbanCol
      status={col.key}
      label={col.label}
      tasks={tasksForStatus(col.key)}
      onDropTask={(taskId) => moveTask(taskId, col.key)}
    />
  {/each}
</div>

<style>
  .kanban {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--border);
  }
</style>
