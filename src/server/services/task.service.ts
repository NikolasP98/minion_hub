import { eq, and, asc } from 'drizzle-orm';
import { tasks } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface TaskInput {
  missionId: string;
  title: string;
  description?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder?: number;
  metadata?: string;
}

export async function createTask(ctx: TenantContext, input: TaskInput) {
  const now = nowMs();
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
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function listTasks(ctx: TenantContext, missionId: string) {
  return ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.missionId, missionId)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
}

export async function getTask(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));

  return rows[0] ?? null;
}

export async function updateTask(
  ctx: TenantContext,
  id: string,
  data: Partial<Pick<typeof tasks.$inferInsert, 'title' | 'description' | 'status' | 'sortOrder' | 'metadata'>>,
) {
  await ctx.db
    .update(tasks)
    .set({ ...data, updatedAt: nowMs() })
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));
}

export async function deleteTask(ctx: TenantContext, id: string) {
  await ctx.db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)));
}
