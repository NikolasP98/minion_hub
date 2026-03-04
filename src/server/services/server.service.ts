import { eq, and } from 'drizzle-orm';
import { servers, userServers } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { encryptToken, decryptToken } from '$server/auth/crypto';
import type { TenantContext } from './base';

export interface ServerInput {
  id?: string;
  name: string;
  url: string;
  token: string;
  lastConnectedAt?: number | null;
}

export async function upsertServer(
  ctx: TenantContext,
  s: ServerInput,
  userId?: string,
) {
  const now = nowMs();
  const id = s.id ?? newId();
  const { encrypted, iv } = encryptToken(s.token);

  await ctx.db
    .insert(servers)
    .values({
      id,
      tenantId: ctx.tenantId,
      name: s.name,
      url: s.url,
      token: encrypted,
      tokenIv: iv,
      lastConnectedAt: s.lastConnectedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [servers.tenantId, servers.url],
      set: {
        name: s.name,
        token: encrypted,
        tokenIv: iv,
        lastConnectedAt: s.lastConnectedAt ?? null,
        updatedAt: now,
      },
    });

  // Resolve actual server id (conflict may have kept an existing row with a different id)
  const [row] = await ctx.db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(servers.url, s.url)));
  const finalId = row?.id ?? id;

  // Link user → server
  if (userId) {
    await ctx.db
      .insert(userServers)
      .values({ userId, serverId: finalId, createdAt: now })
      .onConflictDoNothing();
  }

  return finalId;
}

export async function listServers(
  ctx: TenantContext,
  userId?: string,
  userEmail?: string,
) {
  const isAdmin = userEmail === 'admin@minion.hub';

  if (isAdmin || !userId) {
    const rows = await ctx.db
      .select({
        id: servers.id,
        name: servers.name,
        url: servers.url,
        token: servers.token,
        tokenIv: servers.tokenIv,
        lastConnectedAt: servers.lastConnectedAt,
      })
      .from(servers)
      .where(eq(servers.tenantId, ctx.tenantId))
      .orderBy(servers.createdAt);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      token: row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token,
      lastConnectedAt: row.lastConnectedAt,
    }));
  }

  const rows = await ctx.db
    .select({
      id: servers.id,
      name: servers.name,
      url: servers.url,
      token: servers.token,
      tokenIv: servers.tokenIv,
      lastConnectedAt: servers.lastConnectedAt,
    })
    .from(servers)
    .innerJoin(userServers, eq(userServers.serverId, servers.id))
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(userServers.userId, userId)))
    .orderBy(servers.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    token: row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token,
    lastConnectedAt: row.lastConnectedAt,
  }));
}

export async function deleteServer(ctx: TenantContext, id: string) {
  await ctx.db
    .delete(servers)
    .where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
}
