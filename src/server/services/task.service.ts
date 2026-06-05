import { eq, and, asc } from 'drizzle-orm';
import { tasks } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import type { CoreCtx } from '$server/auth/core-ctx';

export interface TaskInput {
  missionId: string;
  title: string;
  description?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder?: number;
  metadata?: string;
}

// `tasks` keys on mission_id + tenant_id (no gateway scope). pg stores
// timestamps as Date; keep the Turso-era epoch-number public shape.
type TaskRow = typeof tasks.$inferSelect;

function reshape(row: TaskRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    missionId: row.missionId,
    title: row.title,
    description: row.description,
    status: row.status,
    sortOrder: row.sortOrder,
    metadata: row.metadata,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function createTask(ctx: CoreCtx, input: TaskInput) {
  const id = newId();

  await ctx.db.insert(tasks).values({
    id,
    tenantId: ctx.tenantId,
    missionId: input.missionId,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'backlog',
    sortOrder: input.sortOrder ?? 0,
    metadata: input.metadata ?? null,
  });

  return id;
}

export async function listTasks(ctx: CoreCtx, missionId: string) {
  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.missionId, missionId)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
  return rows.map(reshape);
}

export async function getTask(ctx: CoreCtx, id: string) {
  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));

  const row = rows[0];
  return row ? reshape(row) : null;
}

export async function updateTask(
  ctx: CoreCtx,
  id: string,
  data: Partial<
    Pick<typeof tasks.$inferInsert, 'title' | 'description' | 'status' | 'sortOrder' | 'metadata'>
  >,
) {
  await ctx.db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));
}

export async function deleteTask(ctx: CoreCtx, id: string) {
  await ctx.db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));
}
