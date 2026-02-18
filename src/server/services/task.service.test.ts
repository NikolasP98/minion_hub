import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTask, listTasks, getTask, updateTask, deleteTask } from './task.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-task-id-000000001',
  nowMs: () => 1_700_000_000_000,
}));

describe('createTask', () => {
  it('calls db.insert and returns id', async () => {
    const { db } = createMockDb();
    const id = await createTask(
      { db, tenantId: 't1' },
      { missionId: 'm1', title: 'Set up routing' },
    );
    expect(id).toBe('mock-task-id-000000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults status to backlog and sortOrder to 0', async () => {
    const { db } = createMockDb();
    const id = await createTask(
      { db, tenantId: 't1' },
      { missionId: 'm1', title: 'Task with defaults' },
    );
    expect(typeof id).toBe('string');
  });

  it('accepts custom status and sortOrder', async () => {
    const { db } = createMockDb();
    const id = await createTask(
      { db, tenantId: 't1' },
      { missionId: 'm1', title: 'Urgent task', status: 'todo', sortOrder: 5 },
    );
    expect(typeof id).toBe('string');
  });
});

describe('listTasks', () => {
  it('returns tasks ordered by sortOrder', async () => {
    const { db, resolve } = createMockDb();
    const mockTasks = [
      { id: 't1', title: 'First', sortOrder: 0 },
      { id: 't2', title: 'Second', sortOrder: 1 },
    ];
    resolve(mockTasks);
    const result = await listTasks({ db, tenantId: 't1' }, 'm1');
    expect(result).toEqual(mockTasks);
  });

  it('returns empty array when no tasks', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listTasks({ db, tenantId: 't1' }, 'm1');
    expect(result).toEqual([]);
  });
});

describe('getTask', () => {
  it('returns task when found', async () => {
    const { db, resolve } = createMockDb();
    const mockTask = { id: 't1', title: 'Task 1', status: 'backlog' };
    resolve([mockTask]);
    const result = await getTask({ db, tenantId: 't1' }, 't1');
    expect(result).toEqual(mockTask);
  });

  it('returns null when not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await getTask({ db, tenantId: 't1' }, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('updateTask', () => {
  it('updates status without error', async () => {
    const { db } = createMockDb();
    await updateTask({ db, tenantId: 't1' }, 't1', { status: 'in_progress' });
    expect(db.update).toHaveBeenCalled();
  });

  it('updates sortOrder without error', async () => {
    const { db } = createMockDb();
    await updateTask({ db, tenantId: 't1' }, 't1', { sortOrder: 3 });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('deleteTask', () => {
  it('calls db.delete without error', async () => {
    const { db } = createMockDb();
    await deleteTask({ db, tenantId: 't1' }, 't1');
    expect(db.delete).toHaveBeenCalled();
  });
});
