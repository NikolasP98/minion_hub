import { eq, and, asc } from 'drizzle-orm';
import { sessionTasks } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface SessionTaskInput {
  serverId: string;
  sessionKey: string;
  title: string;
  description?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder?: number;
  metadata?: string;
}

export async function createSessionTask(ctx: TenantContext, input: SessionTaskInput) {
  const now = nowMs();
  const id = newId();

  await ctx.db.insert(sessionTasks).values({
    id,
    tenantId: ctx.tenantId,
    serverId: input.serverId,
    sessionKey: input.sessionKey,
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

export async function listSessionTasks(
  ctx: TenantContext,
  serverId: string,
  sessionKey: string,
) {
  const cutoff = nowMs() - 24 * 60 * 60 * 1000;

  const rows = await ctx.db
    .select()
    .from(sessionTasks)
    .where(
      and(
        eq(sessionTasks.tenantId, ctx.tenantId),
        eq(sessionTasks.serverId, serverId),
        eq(sessionTasks.sessionKey, sessionKey),
      ),
    )
    .orderBy(asc(sessionTasks.sortOrder), asc(sessionTasks.createdAt));

  // Filter out done tasks older than 24h
  return rows.filter(
    (t) => !(t.status === 'done' && t.updatedAt < cutoff),
  );
}

export async function updateSessionTask(
  ctx: TenantContext,
  id: string,
  data: Partial<Pick<typeof sessionTasks.$inferInsert, 'title' | 'description' | 'status' | 'sortOrder' | 'metadata'>>,
) {
  await ctx.db
    .update(sessionTasks)
    .set({ ...data, updatedAt: nowMs() })
    .where(and(eq(sessionTasks.id, id), eq(sessionTasks.tenantId, ctx.tenantId)));
}

export async function deleteSessionTask(ctx: TenantContext, id: string) {
  await ctx.db
    .delete(sessionTasks)
    .where(and(eq(sessionTasks.id, id), eq(sessionTasks.tenantId, ctx.tenantId)));
}
