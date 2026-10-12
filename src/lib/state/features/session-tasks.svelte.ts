export interface SessionTaskData {
  id: string;
  tenantId: string;
  serverId: string;
  sessionKey: string;
  title: string;
  description: string | null;
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder: number;
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
}

export const sessionTasksState = $state({
  tasksBySession: {} as Record<string, SessionTaskData[]>,
  loading: false,
});

export async function loadSessionTasks(serverId: string, sessionKey: string) {
  sessionTasksState.loading = true;
  try {
    const res = await fetch(
      `/api/servers/${serverId}/sessions/${encodeURIComponent(sessionKey)}/tasks`,
    );
    if (!res.ok) return;
    const { tasks } = await res.json();
    sessionTasksState.tasksBySession[sessionKey] = tasks;
  } catch {
    /* non-critical */
  } finally {
    sessionTasksState.loading = false;
  }
}
