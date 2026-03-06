export interface MissionData {
  id: string;
  tenantId: string;
  serverId: string;
  sessionId: string;
  title: string;
  description: string | null;
  status: 'active' | 'completed' | 'cancelled';
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskData {
  id: string;
  tenantId: string;
  missionId: string;
  title: string;
  description: string | null;
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder: number;
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
}

export const missionsState = $state({
  missionsBySession: {} as Record<string, MissionData[]>,
  tasksByMission: {} as Record<string, TaskData[]>,
  loading: false,
});
