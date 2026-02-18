import { eq, and, desc } from 'drizzle-orm';
import { bugs } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface BugInput {
  serverId: string;
  agentId?: string;
  errorCode?: string;
  message: string;
  stack?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  metadata?: string;
}

export async function createBug(ctx: TenantContext, input: BugInput) {
  const now = nowMs();
  const id = newId();

  await ctx.db.insert(bugs).values({
    id,
    tenantId: ctx.tenantId,
    serverId: input.serverId,
    agentId: input.agentId ?? null,
    errorCode: input.errorCode ?? null,
    message: input.message,
    stack: input.stack ?? null,
    severity: input.severity ?? 'medium',
    metadata: input.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function listBugs(
  ctx: TenantContext,
  filters?: { serverId?: string; status?: string; severity?: string },
) {
  let query = ctx.db
    .select()
    .from(bugs)
    .where(eq(bugs.tenantId, ctx.tenantId))
    .orderBy(desc(bugs.createdAt))
    .$dynamic();

  if (filters?.serverId) {
    query = query.where(and(eq(bugs.tenantId, ctx.tenantId), eq(bugs.serverId, filters.serverId)));
  }

  return query.limit(200);
}

export async function getBug(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(bugs)
    .where(and(eq(bugs.id, id), eq(bugs.tenantId, ctx.tenantId)));

  return rows[0] ?? null;
}

export async function updateBugStatus(
  ctx: TenantContext,
  id: string,
  status: 'new' | 'acknowledged' | 'resolved' | 'ignored',
) {
  await ctx.db
    .update(bugs)
    .set({ status, updatedAt: nowMs() })
    .where(and(eq(bugs.id, id), eq(bugs.tenantId, ctx.tenantId)));
}
