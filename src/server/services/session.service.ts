import { eq, and, desc } from 'drizzle-orm';
import { sessions } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface SessionInput {
  id?: string;
  serverId: string;
  agentId: string;
  sessionKey: string;
  status?: 'running' | 'thinking' | 'idle' | 'aborted' | 'completed';
  metadata?: string;
  startedAt?: number;
  endedAt?: number;
}

export async function upsertSession(ctx: TenantContext, input: SessionInput) {
  const now = nowMs();
  const id = input.id ?? newId();

  await ctx.db
    .insert(sessions)
    .values({
      id,
      tenantId: ctx.tenantId,
      serverId: input.serverId,
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      status: input.status ?? 'idle',
      metadata: input.metadata ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sessions.tenantId, sessions.serverId, sessions.sessionKey],
      set: {
        status: input.status ?? 'idle',
        metadata: input.metadata ?? null,
        endedAt: input.endedAt ?? null,
        updatedAt: now,
      },
    });

  return id;
}

export async function listSessions(ctx: TenantContext, serverId: string) {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.serverId, serverId), eq(sessions.tenantId, ctx.tenantId)))
    .orderBy(desc(sessions.updatedAt));
}

export async function listSessionsByServer(
  ctx: TenantContext,
  serverId: string,
  agentId?: string,
) {
  const conditions = [
    eq(sessions.serverId, serverId),
    eq(sessions.tenantId, ctx.tenantId),
    ...(agentId ? [eq(sessions.agentId, agentId)] : []),
  ];
  return ctx.db
    .select()
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.updatedAt));
}

export async function getSession(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, ctx.tenantId)));

  return rows[0] ?? null;
}
