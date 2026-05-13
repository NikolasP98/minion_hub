import { eq, and } from 'drizzle-orm';
import { servers, userServers } from '@minion-stack/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { encryptToken, decryptToken } from '$server/auth/crypto';
import type { TenantContext } from './base';

export interface ServerInput {
  id?: string;
  name: string;
  url: string;
  /**
   * When undefined or empty on update, the existing token is preserved.
   * (Empty-string is the explicit "blank token" sentinel only when no row
   * exists yet — i.e. creating a new host with no token.)
   */
  token?: string;
  lastConnectedAt?: number | null;
}

export async function upsertServer(ctx: TenantContext, s: ServerInput, userId?: string) {
  const now = nowMs();
  const id = s.id ?? newId();
  const hasNewToken = typeof s.token === 'string' && s.token.length > 0;
  const enc = hasNewToken ? encryptToken(s.token as string) : null;

  // For new rows we still need *some* value (column is NOT NULL with '' default).
  const insertEncrypted = enc?.encrypted ?? '';
  const insertIv = enc?.iv ?? '';

  // Build the conflict-update set: only overwrite token columns when a
  // non-empty token was supplied. This lets the Edit UI submit `token: ''`
  // (or omit token entirely) to mean "leave the stored token alone".
  const conflictSet: Record<string, unknown> = {
    name: s.name,
    lastConnectedAt: s.lastConnectedAt ?? null,
    updatedAt: now,
  };
  if (enc) {
    conflictSet.token = enc.encrypted;
    conflictSet.tokenIv = enc.iv;
  }

  await ctx.db
    .insert(servers)
    .values({
      id,
      tenantId: ctx.tenantId,
      name: s.name,
      url: s.url,
      token: insertEncrypted,
      tokenIv: insertIv,
      lastConnectedAt: s.lastConnectedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [servers.tenantId, servers.url],
      set: conflictSet,
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

/**
 * Lists hosts WITHOUT tokens. Tokens are fetched separately via
 * `getServerToken` immediately before opening a WebSocket so they cannot
 * drift in client-side cache. Returns metadata only.
 */
export async function listServers(ctx: TenantContext, userId?: string, userRole?: string) {
  const isAdmin = userRole === 'admin';

  const baseCols = {
    id: servers.id,
    name: servers.name,
    url: servers.url,
    lastConnectedAt: servers.lastConnectedAt,
  };

  if (isAdmin || !userId) {
    return ctx.db
      .select(baseCols)
      .from(servers)
      .where(eq(servers.tenantId, ctx.tenantId))
      .orderBy(servers.createdAt);
  }

  return ctx.db
    .select(baseCols)
    .from(servers)
    .innerJoin(userServers, eq(userServers.serverId, servers.id))
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(userServers.userId, userId)))
    .orderBy(servers.createdAt);
}

/**
 * Returns the decrypted gateway token for a single server. Caller is
 * responsible for authorisation (route must require an authenticated
 * session and verify the user is linked to the server when non-admin).
 * Returns null when the server doesn't exist or has no token stored.
 */
export async function getServerToken(ctx: TenantContext, id: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ token: servers.token, tokenIv: servers.tokenIv })
    .from(servers)
    .where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)))
    .limit(1);
  if (!row) return null;
  if (!row.tokenIv) return row.token || null;
  return decryptToken(row.token, row.tokenIv) || null;
}

export async function deleteServer(ctx: TenantContext, id: string) {
  await ctx.db.delete(servers).where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
}
