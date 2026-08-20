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
 * SECURITY: this mutation is NOT tenant-scoped, and the call site does not close
 * that gap for admins. assertOwnsOrAdmin() in
 * src/routes/api/servers/[id]/+server.ts returns true for ANY admin before this
 * runs, so an admin of one organization who supplies another organization's
 * server id patches that row — name, url, gateway token — and receives `ok`.
 * Only non-admins are narrowed (userHasGatewayAccess + the userServers link).
 *
 * The tenantId scope is withheld deliberately, not by oversight: ctx.tenantId
 * carries the post-migration Supabase UUID, and it is not yet proven that every
 * stored Turso row was re-keyed off the old Better-Auth UUID. If any row was
 * not, eq(servers.tenantId, ctx.tenantId) matches nothing and silently no-ops
 * its legitimate owner's updates instead of denying a cross-tenant one.
 *
 * TODO(handoff): add eq(servers.tenantId, ctx.tenantId) to the WHERE below
 * (spec Slice 2) once a credential holder has proven the re-key against real
 * non-production and production data. Blocked on human evidence, not on code:
 * `bun run rekey:readiness` exits 1 and names every missing artifact, and the
 * suite reds either way round once the evidence lands
 * (src/server/services/server.service.test.ts, "updateServer tenant scope").
 * Pointer: docs/runbooks/server-tenant-scope-rekey-readiness.md and
 * specs/2026-08-18-hub-updateserver-tenant-scope-spec.md.
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
