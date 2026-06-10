import { eq, and, or, sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { encrypt, decrypt } from '$server/auth/crypto';
import { gateway, userGateway } from '@minion-stack/db/pg';

/**
 * Resolve a server identifier — the legacy Turso server id carried in
 * `/api/servers/[id]/*` URLs (or already a gateway uuid) — to the Supabase
 * `gateway.id`. The bridge is `gateway.legacy_server_id` (populated from the
 * canonical cloud-Turso server ids during the gateway data migration).
 * Returns null if nothing bridges that id. Cached for the process lifetime —
 * gateway↔server mappings are effectively immutable.
 */
const _gatewayIdCache = new Map<string, string>();

export async function resolveGatewayId(serverId: string): Promise<string | null> {
  const hit = _gatewayIdCache.get(serverId);
  if (hit) return hit;
  const [row] = await getCoreDb()
    .select({ id: gateway.id })
    .from(gateway)
    // id::text so a non-uuid serverId can't raise an invalid-uuid error.
    .where(or(eq(gateway.legacyServerId, serverId), sql`${gateway.id}::text = ${serverId}`))
    .limit(1);
  if (!row) return null;
  _gatewayIdCache.set(serverId, row.id);
  return row.id;
}

/**
 * Reverse of `resolveGatewayId`: a gateway.id → the legacy Turso server id it
 * bridges (gateway.legacy_server_id), falling back to the gateway id itself.
 * For services that read a pg row keyed by gateway_id but must echo the
 * serverId the frontend keys by (when the caller didn't supply it).
 */
const _serverIdCache = new Map<string, string>();

export async function resolveServerId(gatewayId: string): Promise<string> {
  const hit = _serverIdCache.get(gatewayId);
  if (hit) return hit;
  const [row] = await getCoreDb()
    .select({ legacyServerId: gateway.legacyServerId })
    .from(gateway)
    .where(eq(gateway.id, gatewayId))
    .limit(1);
  const serverId = row?.legacyServerId ?? gatewayId;
  _serverIdCache.set(gatewayId, serverId);
  return serverId;
}

export interface GatewayInput {
  name: string;
  url: string;
  /** Plain-text token — sealed before storage. */
  token: string;
  profileId: string;
  isDefault?: boolean;
}

export interface GatewayRow {
  id: string;
  name: string;
  url: string;
  authMode: string;
  createdAt: Date;
}

export async function createGateway(input: GatewayInput): Promise<{ id: string }> {
  const db = getCoreDb();
  const { ciphertext, iv } = encrypt(input.token);
  const [row] = await db
    .insert(gateway)
    .values({
      name: input.name,
      url: input.url,
      tokenCiphertext: ciphertext,
      tokenIv: iv,
    })
    .returning({ id: gateway.id });
  if (!row) throw new Error('createGateway: insert returned no rows');
  await db.insert(userGateway).values({
    profileId: input.profileId,
    gatewayId: row.id,
    isDefault: input.isDefault ?? true,
  });
  return { id: row.id };
}

export async function listGatewaysForAdmin(): Promise<GatewayRow[]> {
  const db = getCoreDb();
  const rows = await db
    .select({
      id: gateway.id,
      name: gateway.name,
      url: gateway.url,
      authMode: gateway.authMode,
      createdAt: gateway.createdAt,
    })
    .from(gateway)
    .orderBy(gateway.createdAt);
  return rows as GatewayRow[];
}

export async function deleteGateway(id: string): Promise<void> {
  await getCoreDb().delete(gateway).where(eq(gateway.id, id));
}

/** Host row in the shape the frontend + still-Turso `/api/servers/[id]/*` routes
 * expect: `id` is the legacy Turso server id (bridged via gateway.legacy_server_id)
 * so server-scoped routes keep resolving, and `lastConnectedAt` is epoch-ms. */
export interface UserHostRow {
  id: string;
  name: string;
  url: string;
  lastConnectedAt: number | null;
}

/**
 * List the hosts visible to a user, from Supabase `gateway` (+ `user_gateway`
 * for non-admins). Replaces the Turso `servers`/`user_servers` read in
 * `loadHostsForUser` — keyed by the profile uuid, never the legacy id.
 *   - admin → all gateways in the project
 *   - non-admin → only gateways linked via `user_gateway` (by profile id)
 *   - non-admin with no profile id → []
 */
export async function listGatewayHostsForUser(
  profileId: string | null,
  isAdmin: boolean,
): Promise<UserHostRow[]> {
  const db = getCoreDb();
  const cols = {
    id: gateway.id,
    legacyServerId: gateway.legacyServerId,
    name: gateway.name,
    url: gateway.url,
    lastConnectedAt: gateway.lastConnectedAt,
  };
  const rows = isAdmin
    ? await db.select(cols).from(gateway).orderBy(gateway.createdAt)
    : profileId
      ? await db
          .select(cols)
          .from(gateway)
          .innerJoin(userGateway, eq(userGateway.gatewayId, gateway.id))
          .where(eq(userGateway.profileId, profileId))
          .orderBy(gateway.createdAt)
      : [];
  return rows.map((r) => ({
    id: r.legacyServerId ?? r.id,
    name: r.name,
    url: r.url,
    lastConnectedAt: r.lastConnectedAt ? r.lastConnectedAt.getTime() : null,
  }));
}

/**
 * Return the decrypted token for a gateway identified by a server id (legacy
 * Turso id or gateway uuid). Used by the /api/servers/[id]/token endpoint so
 * it reads from Supabase after the Turso→Supabase cutover.
 * Returns null when the id doesn't resolve or the gateway has no token.
 */
export async function getGatewayTokenByServerId(serverId: string): Promise<string | null> {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;
  const [row] = await getCoreDb()
    .select({ tokenCiphertext: gateway.tokenCiphertext, tokenIv: gateway.tokenIv })
    .from(gateway)
    .where(eq(gateway.id, gatewayId))
    .limit(1);
  if (!row?.tokenCiphertext) return null;
  // token_iv='' means the ciphertext IS the plaintext token (legacy unencrypted row).
  if (!row.tokenIv) return row.tokenCiphertext;
  return decrypt(row.tokenCiphertext, row.tokenIv);
}

/**
 * Return the URL + decrypted token for a user's default (or first) linked gateway.
 * Called by gateway-rpc to resolve per-user credentials from Postgres.
 */
export async function getUserGatewayCredentials(
  profileId: string,
): Promise<{ url: string; token: string } | null> {
  const db = getCoreDb();
  const rows = await db
    .select({
      url: gateway.url,
      tokenCiphertext: gateway.tokenCiphertext,
      tokenIv: gateway.tokenIv,
    })
    .from(userGateway)
    .innerJoin(gateway, eq(userGateway.gatewayId, gateway.id))
    .where(eq(userGateway.profileId, profileId))
    .limit(1);
  if (!rows.length) return null;
  const { url, tokenCiphertext, tokenIv } = rows[0];
  const token = decrypt(tokenCiphertext, tokenIv);
  return { url, token };
}

/**
 * System-wide gateway credentials (no user context) from Supabase `gateway` —
 * the Supabase-native replacement for the Turso `getSystemGatewayCredentials`.
 * Picks the gateway whose `url` matches `preferredUrl`, else the first row.
 * Used by the cache broadcaster + gateway-rpc system fallback. `token_iv=''`
 * means the ciphertext IS the plaintext token (legacy unencrypted row).
 */
export async function getSystemGatewayCredentials(
  preferredUrl?: string,
): Promise<{ url: string; token: string } | null> {
  const rows = await getCoreDb()
    .select({
      url: gateway.url,
      tokenCiphertext: gateway.tokenCiphertext,
      tokenIv: gateway.tokenIv,
    })
    .from(gateway);
  if (!rows.length) return null;
  const row = preferredUrl ? (rows.find((r) => r.url === preferredUrl) ?? rows[0]) : rows[0];
  if (!row.tokenCiphertext) return null;
  const token = row.tokenIv ? decrypt(row.tokenCiphertext, row.tokenIv) : row.tokenCiphertext;
  return { url: row.url, token };
}

/**
 * True if the profile is linked (via `user_gateway`) to the gateway behind the
 * given server id (legacy Turso id or gateway uuid). The Supabase-native
 * replacement for the Turso `user_servers` access check on `/api/servers/[id]/*`.
 * Returns false for a null profile or an unbridged server id.
 */
export async function userHasGatewayAccess(
  profileId: string | null,
  serverId: string,
): Promise<boolean> {
  if (!profileId) return false;
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return false;
  const [row] = await getCoreDb()
    .select({ profileId: userGateway.profileId })
    .from(userGateway)
    .where(and(eq(userGateway.profileId, profileId), eq(userGateway.gatewayId, gatewayId)))
    .limit(1);
  return !!row;
}

/**
 * Onboarding default-server policy. Until more gateways are provisioned and
 * load management exists, every new user connects to the single shared
 * `netcup` gateway. If the user has no gateway link yet, link netcup as their
 * default so onboarding (channel setup + agent creation, which run over the
 * gateway WS) has a live connection to establish.
 *
 * Idempotent: no-op when the user already has any gateway link (don't override
 * an explicit selection) or when no `netcup` gateway is configured. Replace the
 * name match with real load-balancing once multiple gateways exist.
 */
export async function ensureDefaultGatewayForUser(profileId: string): Promise<void> {
  if (!profileId) return;
  const db = getCoreDb();

  const [existing] = await db
    .select({ profileId: userGateway.profileId })
    .from(userGateway)
    .where(eq(userGateway.profileId, profileId))
    .limit(1);
  if (existing) return;

  const [netcup] = await db
    .select({ id: gateway.id })
    .from(gateway)
    .where(sql`lower(${gateway.name}) = 'netcup'`)
    .limit(1);
  if (!netcup) return;

  await db
    .insert(userGateway)
    .values({ profileId, gatewayId: netcup.id, isDefault: true })
    .onConflictDoNothing();
}

export async function linkGatewayToUser(profileId: string, gatewayId: string): Promise<void> {
  const db = getCoreDb();
  await db
    .insert(userGateway)
    .values({ profileId, gatewayId, isDefault: false })
    .onConflictDoNothing();
}

export async function unlinkGatewayFromUser(profileId: string, gatewayId: string): Promise<void> {
  await getCoreDb()
    .delete(userGateway)
    .where(and(eq(userGateway.profileId, profileId), eq(userGateway.gatewayId, gatewayId)));
}
