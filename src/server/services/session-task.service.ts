import { eq, and, asc } from 'drizzle-orm';
import { sessionTasks } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId } from '$server/services/gateway.pg.service';

export interface SessionTaskInput {
  serverId: string;
  sessionKey: string;
  title: string;
  description?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'done';
  sortOrder?: number;
  metadata?: string;
}

// pg keys on gateway_id + stores timestamps as Date; this service keeps the
// Turso-era public shape (serverId echoed, epoch-number timestamps).
type SessionTaskRow = typeof sessionTasks.$inferSelect;

function reshape(row: SessionTaskRow, serverId: string) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId,
    sessionKey: row.sessionKey,
    title: row.title,
    description: row.description,
    status: row.status,
    sortOrder: row.sortOrder,
    metadata: row.metadata,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function createSessionTask(ctx: CoreCtx, input: SessionTaskInput) {
  const gatewayId = await resolveGatewayId(input.serverId);
  if (!gatewayId) throw new Error(`No gateway found for server ${input.serverId}`);
  const id = newId();

  await withOrgCore(ctx, (tx) =>
    tx.insert(sessionTasks).values({
      id,
      tenantId: ctx.tenantId,
      gatewayId,
      sessionKey: input.sessionKey,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'backlog',
      sortOrder: input.sortOrder ?? 0,
      metadata: input.metadata ?? null,
    }),
  );

  return id;
}

export async function listSessionTasks(ctx: CoreCtx, serverId: string, sessionKey: string) {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(sessionTasks)
      .where(
        and(
          eq(sessionTasks.tenantId, ctx.tenantId),
          eq(sessionTasks.gatewayId, gatewayId),
          eq(sessionTasks.sessionKey, sessionKey),
        ),
      )
      .orderBy(asc(sessionTasks.sortOrder), asc(sessionTasks.createdAt)),
  );

  // Filter out done tasks older than 24h
  return rows
    .map((r) => reshape(r, serverId))
    .filter((t) => !(t.status === 'done' && t.updatedAt < cutoff));
}

export async function updateSessionTask(
  ctx: CoreCtx,
  id: string,
  data: Partial<
    Pick<
      typeof sessionTasks.$inferInsert,
      'title' | 'description' | 'status' | 'sortOrder' | 'metadata'
    >
  >,
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(sessionTasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(sessionTasks.id, id), eq(sessionTasks.tenantId, ctx.tenantId))),
  );
}

export async function deleteSessionTask(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(sessionTasks)
      .where(and(eq(sessionTasks.id, id), eq(sessionTasks.tenantId, ctx.tenantId))),
  );
}
