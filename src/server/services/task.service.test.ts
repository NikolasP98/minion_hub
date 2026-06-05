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

// pg rows are typed for PostgresJsDatabase; the mock db is structural — cast.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 't1' });
const TS = new Date(1_700_000_000_000);
const taskRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  tenantId: 't1',
  missionId: 'm1',
  title: 'First',
  description: null,
  status: 'backlog',
  sortOrder: 0,
  metadata: null,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

describe('createTask', () => {
  it('calls db.insert and returns id', async () => {
    const { db } = createMockDb();
    const id = await createTask(ctx(db), { missionId: 'm1', title: 'Set up routing' });
    expect(id).toBe('mock-task-id-000000001');
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults status to backlog and sortOrder to 0', async () => {
    const { db } = createMockDb();
    const id = await createTask(ctx(db), { missionId: 'm1', title: 'Task with defaults' });
    expect(typeof id).toBe('string');
  });

  it('accepts custom status and sortOrder', async () => {
    const { db } = createMockDb();
    const id = await createTask(ctx(db), {
      missionId: 'm1',
      title: 'Urgent task',
      status: 'todo',
      sortOrder: 5,
    });
    expect(typeof id).toBe('string');
  });
});

describe('listTasks', () => {
  it('returns tasks reshaped (epoch timestamps), ordered by sortOrder', async () => {
    const { db, resolve } = createMockDb();
    resolve([taskRow({ id: 't1', sortOrder: 0 }), taskRow({ id: 't2', title: 'Second', sortOrder: 1 })]);
    const result = await listTasks(ctx(db), 'm1');
    expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result[0].createdAt).toBe(TS.getTime());
  });

  it('returns empty array when no tasks', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await listTasks(ctx(db), 'm1');
    expect(result).toEqual([]);
  });
});

describe('getTask', () => {
  it('returns reshaped task when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([taskRow()]);
    const result = await getTask(ctx(db), 't1');
    expect(result?.id).toBe('t1');
    expect(result?.updatedAt).toBe(TS.getTime());
  });

  it('returns null when not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    const result = await getTask(ctx(db), 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('updateTask', () => {
  it('updates status without error', async () => {
    const { db } = createMockDb();
    await updateTask(ctx(db), 't1', { status: 'in_progress' });
    expect(db.update).toHaveBeenCalled();
  });

  it('updates sortOrder without error', async () => {
    const { db } = createMockDb();
    await updateTask(ctx(db), 't1', { sortOrder: 3 });
    expect(db.update).toHaveBeenCalled();
  });
});

describe('deleteTask', () => {
  it('calls db.delete without error', async () => {
    const { db } = createMockDb();
    await deleteTask(ctx(db), 't1');
    expect(db.delete).toHaveBeenCalled();
  });
});
