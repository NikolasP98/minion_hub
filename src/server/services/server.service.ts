import { eq, and } from 'drizzle-orm';
import { servers } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface ServerInput {
  id?: string;
  name: string;
  url: string;
  token: string;
  lastConnectedAt?: number | null;
}

export async function upsertServer(ctx: TenantContext, s: ServerInput) {
  const now = nowMs();
  const id = s.id ?? newId();

  await ctx.db
    .insert(servers)
    .values({
      id,
      tenantId: ctx.tenantId,
      name: s.name,
      url: s.url,
      token: s.token,
      lastConnectedAt: s.lastConnectedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: servers.id,
      set: {
        name: s.name,
        url: s.url,
        token: s.token,
        lastConnectedAt: s.lastConnectedAt ?? null,
        updatedAt: now,
      },
    });

  return id;
}

export async function listServers(ctx: TenantContext) {
  return ctx.db
    .select({
      id: servers.id,
      name: servers.name,
      url: servers.url,
      token: servers.token,
      lastConnectedAt: servers.lastConnectedAt,
    })
    .from(servers)
    .where(eq(servers.tenantId, ctx.tenantId))
    .orderBy(servers.createdAt);
}

export async function deleteServer(ctx: TenantContext, id: string) {
  await ctx.db
    .delete(servers)
    .where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
}
