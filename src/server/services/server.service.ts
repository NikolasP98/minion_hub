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

/**
 * Update an existing server row by id. Avoids the PK-conflict that upsertServer
 * hits when the row's tenantId was migrated to a Supabase UUID but the row still
 * carries the legacy Better-Auth UUID as its primary key.
 *
 * SECURITY: IDOR is gated at the call site via assertOwnsOrAdmin() (which checks
 * userHasGatewayAccess + userServers link) — not here. We intentionally omit a
 * tenantId scope from the WHERE because ctx.tenantId carries the post-migration
 * Supabase UUID while the stored Turso row still carries the old Better-Auth UUID;
 * adding eq(servers.tenantId, ctx.tenantId) would silently no-op every update.
 * TODO: add tenantId scope once Turso server rows are re-keyed to the Supabase UUID.
 */
export async function updateServer(ctx: TenantContext, id: string, updates: Partial<ServerInput>) {
  const now = nowMs();
  const set: Record<string, unknown> = { updatedAt: now };
  if (updates.name != null) set.name = updates.name;
  if (updates.url != null) set.url = updates.url;
  if (updates.lastConnectedAt !== undefined) set.lastConnectedAt = updates.lastConnectedAt;
  if (typeof updates.token === 'string' && updates.token.length > 0) {
    const enc = encryptToken(updates.token);
    set.token = enc.encrypted;
    set.tokenIv = enc.iv;
  }
  await ctx.db.update(servers).set(set).where(eq(servers.id, id));
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
 * Lists hosts visible to the caller WITHOUT tokens. Per-user scoping:
 * - Anonymous (no userId, not admin): returns []. Hosts are never
 *   exposed to unauthenticated visitors. Combined with the unauth
 *   fallback in hooks.server.ts, this makes the response authoritative-
 *   empty rather than 401, so the client cache wipes cleanly.
 * - Authenticated non-admin: only hosts the user is linked to via
 *   `userServers`.
 * - Admin: all hosts in the tenant.
 *
 * Tokens are fetched separately via `getServerToken` immediately before
 * opening a WebSocket so they cannot drift in client-side cache.
 */
export async function listServers(ctx: TenantContext, userId?: string, userRole?: string) {
  const isAdmin = userRole === 'admin';

  if (!userId && !isAdmin) return [];
  // From this point onward, either isAdmin OR userId is defined.
  // The non-admin branch uses userId in the join filter.

  const baseCols = {
    id: servers.id,
    name: servers.name,
    url: servers.url,
    lastConnectedAt: servers.lastConnectedAt,
  };

  if (isAdmin) {
    return ctx.db
      .select(baseCols)
      .from(servers)
      .where(eq(servers.tenantId, ctx.tenantId))
      .orderBy(servers.createdAt);
  }

  // TS-narrow: by this point !isAdmin && userId is defined (anonymous
  // case already returned []).
  return ctx.db
    .select(baseCols)
    .from(servers)
    .innerJoin(userServers, eq(userServers.serverId, servers.id))
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(userServers.userId, userId as string)))
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

/**
 * System-level lookup of a gateway URL+token across ALL tenants. Used by
 * hub-internal admin paths (cache invalidation broadcast, SSR one-shot
 * RPCs) that operate outside of any user session. Replaces reading the
 * gateway token from a Vercel env var — the encrypted DB row is now the
 * single source of truth.
 *
 * Resolution order:
 *   1. If `preferredUrl` is provided, look up the matching server row
 *      across all tenants and return its decrypted token.
 *   2. Otherwise return the oldest server row in the DB.
 *
 * Returns null when no servers exist or decryption fails.
 *
 * NOTE: bypasses tenant scoping by design. Callers must be trusted
 * server-side bootstrap code, never user-facing routes.
 */
export async function getSystemGatewayCredentials(
  db: TenantContext['db'],
  preferredUrl?: string,
): Promise<{ url: string; token: string } | null> {
  const cols = { url: servers.url, token: servers.token, tokenIv: servers.tokenIv };
  const rows = preferredUrl
    ? await db.select(cols).from(servers).where(eq(servers.url, preferredUrl)).limit(1)
    : await db.select(cols).from(servers).orderBy(servers.createdAt).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const token = row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token;
  if (!token) return null;
  return { url: row.url, token };
}
