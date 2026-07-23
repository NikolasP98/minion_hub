import { eq, and, or, sql, desc } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { encrypt, decrypt } from '$server/auth/crypto';
import { gateway, userGateway } from '@minion-stack/db/pg';

/**
 * Resolve a server identifier — the legacy Turso server id carried in
 * `/api/servers/[id]/*` URLs (or already a gateway uuid) — to the Supabase
 * `gateway.id`. The bridge is `gateway.legacy_server_id` (populated from the
 * canonical cloud-Turso server ids during the gateway data migration).
 * Returns null if nothing bridges that id. Cached with a 24h TTL —
 * gateway↔server mappings are effectively immutable, but a TTL keeps a deleted
 * or remapped gateway from resolving to a stale id forever.
 */
const _ID_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const _gatewayIdCache = new Map<string, { value: string; expires: number }>();

export async function resolveGatewayId(serverId: string): Promise<string | null> {
  const hit = _gatewayIdCache.get(serverId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [row] = await getCoreDb()
    .select({ id: gateway.id })
    .from(gateway)
    // id::text so a non-uuid serverId can't raise an invalid-uuid error.
    .where(or(eq(gateway.legacyServerId, serverId), sql`${gateway.id}::text = ${serverId}`))
    .limit(1);
  if (!row) return null;
  _gatewayIdCache.set(serverId, { value: row.id, expires: Date.now() + _ID_CACHE_TTL_MS });
  return row.id;
}

/**
 * Reverse of `resolveGatewayId`: a gateway.id → the legacy Turso server id it
 * bridges (gateway.legacy_server_id), falling back to the gateway id itself.
 * For services that read a pg row keyed by gateway_id but must echo the
 * serverId the frontend keys by (when the caller didn't supply it).
 */
const _serverIdCache = new Map<string, { value: string; expires: number }>();

export async function resolveServerId(gatewayId: string): Promise<string> {
  const hit = _serverIdCache.get(gatewayId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [row] = await getCoreDb()
    .select({ legacyServerId: gateway.legacyServerId })
    .from(gateway)
    .where(eq(gateway.id, gatewayId))
    .limit(1);
  const serverId = row?.legacyServerId ?? gatewayId;
  _serverIdCache.set(gatewayId, { value: serverId, expires: Date.now() + _ID_CACHE_TTL_MS });
  return serverId;
}

/** Build channel a gateway row serves (spec 2026-07-19 §D2). */
export type GatewayChannel = 'dev' | 'prd';

export const GATEWAY_CHANNELS: readonly GatewayChannel[] = ['dev', 'prd'];

export function isGatewayChannel(v: unknown): v is GatewayChannel {
  return v === 'dev' || v === 'prd';
}

/**
 * `channel` is read as a raw expression, NOT as a column on the shared
 * `@minion-stack/db` drizzle table — deliberately.
 *
 * Drizzle expands `.select()` over a schema object into an explicit column
 * list, so adding `channel` to the shared table definition would put
 * `"gateway"."channel"` into EVERY query in every consumer the moment the
 * package is rebuilt, and each one would 500 until the migration landed. That
 * exact failure mode took /finances down on 2026-07-19
 * (`additive-column-breaks-identity-select`).
 *
 * `to_jsonb(row) ->> 'channel'` returns NULL when the column does not exist
 * yet, so the pre-migration state degrades to `'prd'` — the default the
 * migration itself backfills — instead of erroring. Once
 * `20260719210000_gateway_channel_lease.sql` is applied everywhere this can
 * become a plain column reference.
 */
const channelExpr = sql<GatewayChannel>`coalesce(to_jsonb(${gateway}) ->> 'channel', 'prd')`;

/**
 * TOTAL order for any multi-row gateway pick: preferred channel, then oldest,
 * then id. Every clause matters.
 *
 * `created_at` alone is NOT a total order — PINONITE's dev and prd rows were
 * inserted in the same transaction and therefore share a `created_at` to the
 * microsecond, so the tiebreak fell to Postgres heap order and a server-side
 * RPC could land on the protopi DEV gateway instead of netcup PRD. `id` is the
 * primary key, so appending it makes the order total and the pick reproducible.
 *
 * The channel clause comes FIRST because a wrong channel is a worse outcome
 * than a wrong instance: `preferred` defaults to `'prd'` everywhere, so the
 * only way to reach `dev` is to ask for it explicitly.
 */
function channelFirst(preferred: GatewayChannel) {
  return sql`(${channelExpr} = ${preferred}) desc`;
}

export interface GatewayInput {
  name: string;
  url: string;
  /** Plain-text token — sealed before storage. */
  token: string;
  profileId: string;
  /** Active organization assigned to this gateway row. */
  orgId: string;
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
      orgId: input.orgId,
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

export async function listGatewaysForOrgAdmin(orgId: string): Promise<GatewayRow[]> {
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
    .where(eq(gateway.orgId, orgId))
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
  /** Org currently ASSIGNED to this gateway instance (per-org volume tenancy
   * spec §3.4) — a mutable lease read-model, not ownership. Null = shared/
   * default pool. */
  orgId: string | null;
  /** Build channel this row serves. Pre-migration rows read as 'prd'. */
  channel: GatewayChannel;
}

/**
 * List the hosts visible to a user, from Supabase `gateway` (+ `user_gateway`
 * for non-admins). Replaces the Turso `servers`/`user_servers` read in
 * `loadHostsForUser` — keyed by the profile uuid, never the legacy id.
 *
 * Visibility is ACTIVE ORG first, then the user link:
 *   - no active org        → []          (fail closed)
 *   - admin                → the active org's rows
 *   - non-admin            → the active org's rows the user is linked to
 *   - non-admin, no profile → []
 *
 * ⚠️ Admin is NOT a cross-org escape hatch here. The previous behavior ("admin →
 * all gateways in the project") is precisely the fail-open shape that let one
 * org see another's channels (`channel-identity-org-scoping-failopen`). An admin
 * of org A switching to org B sees org B's rows and no others; to reach org A's
 * gateways they switch back.
 *
 * ⚠️ `user_gateway` currently links all 7 users to both legacy rows. That sprawl
 * is now harmless — the org predicate is ANDed, not ORed — but it is still worth
 * pruning (see supabase/scripts/2026-07-19-gateway-channel-repoint.sql §7).
 */
export async function listGatewayHostsForUser(
  profileId: string | null,
  isAdmin: boolean,
  orgId: string | null,
): Promise<UserHostRow[]> {
  // Fail closed. An absent active org is not "show everything" — that is how a
  // hand-crafted request reaches a channel the caller's org does not have.
  if (!orgId) return [];
  const db = getCoreDb();
  const cols = {
    id: gateway.id,
    legacyServerId: gateway.legacyServerId,
    name: gateway.name,
    url: gateway.url,
    lastConnectedAt: gateway.lastConnectedAt,
    orgId: gateway.orgId,
    channel: channelExpr,
  };
  const rows = isAdmin
    ? await db
        .select(cols)
        .from(gateway)
        .where(eq(gateway.orgId, orgId))
        .orderBy(gateway.createdAt, gateway.id)
    : profileId
      ? await db
          .select(cols)
          .from(gateway)
          .innerJoin(userGateway, eq(userGateway.gatewayId, gateway.id))
          .where(and(eq(userGateway.profileId, profileId), eq(gateway.orgId, orgId)))
          .orderBy(gateway.createdAt, gateway.id)
      : [];
  return rows.map((r) => ({
    id: r.legacyServerId ?? r.id,
    name: r.name,
    url: r.url,
    lastConnectedAt: r.lastConnectedAt ? r.lastConnectedAt.getTime() : null,
    orgId: r.orgId ?? null,
    channel: isGatewayChannel(r.channel) ? r.channel : 'prd',
  }));
}

/** Candidate instance for a (org, channel) pair — the resolver's input set. */
export interface ChannelCandidate {
  gatewayId: string;
  serverId: string;
  name: string;
  url: string;
  token: string;
}

/**
 * Every gateway row assigned to `(orgId, channel)`, oldest first, with tokens
 * decrypted. The fail-closed authority behind both the picker and the lease
 * resolver: an org with no row for a channel gets `[]` and therefore cannot
 * select it, no matter what the client asks for.
 *
 * Tokenless rows are excluded — a row we cannot authenticate to is not a
 * candidate, and returning it would surface as a confusing NOT_PAIRED close
 * rather than "this channel is unavailable".
 */
export async function listChannelCandidates(
  orgId: string,
  channel: GatewayChannel,
): Promise<ChannelCandidate[]> {
  const rows = await getCoreDb()
    .select({
      id: gateway.id,
      legacyServerId: gateway.legacyServerId,
      name: gateway.name,
      url: gateway.url,
      tokenCiphertext: gateway.tokenCiphertext,
      tokenIv: gateway.tokenIv,
      channel: channelExpr,
    })
    .from(gateway)
    .where(eq(gateway.orgId, orgId))
    .orderBy(gateway.createdAt, gateway.id);
  return rows
    .filter((r) => (isGatewayChannel(r.channel) ? r.channel : 'prd') === channel)
    .filter((r) => r.tokenCiphertext)
    .map((r) => ({
      gatewayId: r.id,
      serverId: r.legacyServerId ?? r.id,
      name: r.name,
      url: r.url,
      // token_iv='' means the ciphertext IS the plaintext token (legacy row).
      token: r.tokenIv ? decrypt(r.tokenCiphertext, r.tokenIv) : r.tokenCiphertext,
    }));
}

/**
 * Channels the org actually has rows for, in display order (prd first — it is
 * the safe default and the only channel FACES has). An org with one entry gets
 * no picker at all (spec §D2).
 */
export async function listOrgChannels(orgId: string | null): Promise<GatewayChannel[]> {
  if (!orgId) return [];
  const rows = await getCoreDb()
    .select({ channel: channelExpr })
    .from(gateway)
    .where(eq(gateway.orgId, orgId));
  const present = new Set(rows.map((r) => (isGatewayChannel(r.channel) ? r.channel : 'prd')));
  return (['prd', 'dev'] as const).filter((c) => present.has(c));
}

/**
 * True when `serverId` resolves to a gateway row assigned to `orgId`. The
 * server-side gate on `/api/servers/[id]/*`: UI-only gating is a bug, and
 * "admin" is not an exemption (see `listGatewayHostsForUser`).
 */
export async function gatewayBelongsToOrg(
  serverId: string,
  orgId: string | null,
): Promise<boolean> {
  if (!orgId) return false;
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return false;
  const [row] = await getCoreDb()
    .select({ id: gateway.id })
    .from(gateway)
    .where(and(eq(gateway.id, gatewayId), eq(gateway.orgId, orgId)))
    .limit(1);
  return !!row;
}

/**
 * Return the decrypted token for a gateway identified by a server id (legacy
 * Turso id or gateway uuid) only when it belongs to the active organization.
 * Used by the /api/servers/[id]/token endpoint so it reads from Supabase after
 * the Turso→Supabase cutover without a check/read reassignment race.
 * Returns null when the id doesn't resolve, belongs to another org, or has no
 * token.
 */
export async function getGatewayTokenByServerId(
  serverId: string,
  orgId: string,
): Promise<string | null> {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;
  const [row] = await getCoreDb()
    .select({ tokenCiphertext: gateway.tokenCiphertext, tokenIv: gateway.tokenIv })
    .from(gateway)
    .where(and(eq(gateway.id, gatewayId), eq(gateway.orgId, orgId)))
    .limit(1);
  if (!row?.tokenCiphertext) return null;
  // token_iv='' means the ciphertext IS the plaintext token (legacy unencrypted row).
  if (!row.tokenIv) return row.tokenCiphertext;
  return decrypt(row.tokenCiphertext, row.tokenIv);
}

/**
 * URL + decrypted token for one gateway row by id — the fleet-update
 * orchestrator's per-instance credential lookup (spec §3.2). Unlike the
 * user/org/system resolution chain, this addresses a SPECIFIC instance.
 * `token_iv=''` means the ciphertext IS the plaintext token (legacy row).
 */
export async function getGatewayCredentialsById(
  gatewayId: string,
): Promise<{ url: string; token: string } | null> {
  const [row] = await getCoreDb()
    .select({
      url: gateway.url,
      tokenCiphertext: gateway.tokenCiphertext,
      tokenIv: gateway.tokenIv,
    })
    .from(gateway)
    .where(eq(gateway.id, gatewayId))
    .limit(1);
  if (!row?.tokenCiphertext) return null;
  const token = row.tokenIv ? decrypt(row.tokenCiphertext, row.tokenIv) : row.tokenCiphertext;
  return { url: row.url, token };
}

/**
 * Return the URL + decrypted token for a user's default (or first) linked gateway.
 * Called by gateway-rpc to resolve per-user credentials from Postgres.
 *
 * ⚠️ `limit(1)` with no ORDER BY let Postgres pick an ARBITRARY row for anyone
 * linked to more than one gateway — so consecutive requests from the same user
 * could resolve to DIFFERENT gateways, and any stale/unreachable one made
 * server-side RPCs fail intermittently while the browser (which uses the
 * explicitly selected host) worked fine. Ordering makes selection deterministic.
 *
 * This is the FALLBACK path — the acting org's channel lease (tried first in
 * gateway-rpc) is the real source of truth. It still has to be channel-aware:
 * `user_gateway` links every user to every row, and the dev rows are the
 * NEWEST, so plain newest-first handed the fallback a DEV gateway. `channel`
 * defaults to `'prd'`, and the order is total (channel → created_at → id) so
 * rows sharing a `created_at` cannot flip between requests.
 */
export async function getUserGatewayCredentials(
  profileId: string,
  orgId: string,
  channel: GatewayChannel = 'prd',
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
    .where(and(eq(userGateway.profileId, profileId), eq(gateway.orgId, orgId)))
    .orderBy(channelFirst(channel), desc(gateway.createdAt), gateway.id)
    .limit(1);
  if (!rows.length) return null;
  const { url, tokenCiphertext, tokenIv } = rows[0];
  if (!tokenCiphertext) return null;
  // token_iv='' means the ciphertext IS the plaintext token (legacy unencrypted
  // row). Mirror getGatewayTokenByServerId/getSystemGatewayCredentials — without
  // this guard, decrypt() throws ERR_CRYPTO_INVALID_IV on a plaintext row and the
  // caller silently falls back to a stale Turso token ("gateway token mismatch").
  const token = tokenIv ? decrypt(tokenCiphertext, tokenIv) : tokenCiphertext;
  return { url, token };
}

/**
 * System-wide gateway credentials (no user context) from Supabase `gateway` —
 * the Supabase-native replacement for the Turso `getSystemGatewayCredentials`.
 * Picks the gateway whose `url` matches `preferredUrl`, else the first row that
 * actually carries a token. Used by the cache broadcaster + gateway-rpc system
 * fallback. `token_iv=''` means the ciphertext IS the plaintext token (legacy
 * unencrypted row).
 *
 * Only token-bearing rows are eligible: a tokenless row (e.g. a `local_dev`
 * entry) could otherwise win and return null, silently breaking the reminders
 * cron. The rows are ordered `prd → created_at → id`: unordered heap order let
 * an unattended cron pick the DEV gateway, and `created_at` ties are real (the
 * dev/prd rows for an org were inserted in one transaction).
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
    .from(gateway)
    .orderBy(channelFirst('prd'), gateway.createdAt, gateway.id);
  const tokened = rows.filter((r) => r.tokenCiphertext);
  if (!tokened.length) return null;
  const row = (preferredUrl && tokened.find((r) => r.url === preferredUrl)) || tokened[0];
  const token = row.tokenIv ? decrypt(row.tokenCiphertext, row.tokenIv) : row.tokenCiphertext;
  return { url: row.url, token };
}

/**
 * Per-org gateway credentials used to live here as
 * `getOrgAssignedGatewayCredentials(orgId)` — a channel-BLIND `order by
 * created_at` + "first row with a token". Once every switchable org had both a
 * dev and a prd row it became a coin flip: PINONITE's two rows were inserted in
 * the same transaction, so their `created_at` tie let a server-side RPC resolve
 * to the protopi DEV gateway while the browser sat on netcup PRD — the same
 * client/server split that caused the all-day intermittency.
 *
 * It is deleted, not patched. `(org, channel)` has exactly ONE authority now:
 * `resolveOrgChannelCredentials` in `gateway-lease.service.ts` (spec §D4).
 *
 * (This file cannot import the lease service — the lease service imports
 * `listChannelCandidates` from here.)
 */

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
 * Onboarding default-server policy. If the user has no gateway link yet, link
 * one as their default so onboarding (channel setup + agent creation, which
 * run over the gateway WS) has a live connection to establish.
 *
 * Priority: the gateway currently assigned to the caller's active org
 * (per-org volume tenancy §3.4 — `gateway.org_id` is a mutable assignment,
 * not ownership), else the OLDEST token-bearing gateway row. Instances are
 * neutral (no name-based pins — rows are being renamed to minion-1/minion-2);
 * real load-balancing replaces the oldest-row fallback once it exists.
 *
 * Idempotent: no-op when the user already has any gateway link (don't
 * override an explicit selection) or when no usable gateway row exists.
 */
export async function ensureDefaultGatewayForUser(
  profileId: string,
  orgId?: string | null,
): Promise<void> {
  if (!profileId) return;
  const db = getCoreDb();

  const [existing] = await db
    .select({ profileId: userGateway.profileId })
    .from(userGateway)
    .where(eq(userGateway.profileId, profileId))
    .limit(1);
  if (existing) return;

  if (orgId) {
    const [assigned] = await db
      .select({ id: gateway.id })
      .from(gateway)
      .where(eq(gateway.orgId, orgId))
      .orderBy(channelFirst('prd'), gateway.createdAt, gateway.id)
      .limit(1);
    if (assigned) {
      await db
        .insert(userGateway)
        .values({ profileId, gatewayId: assigned.id, isDefault: true })
        .onConflictDoNothing();
      return;
    }
  }

  // Oldest token-bearing row = the shared default pool (`<> ''` also excludes
  // NULL). Org routing above and resolveCredentialsForUser step-0 handle the
  // specific cases; this is only the "some live gateway" onboarding fallback.
  const [oldest] = await db
    .select({ id: gateway.id })
    .from(gateway)
    .where(sql`${gateway.tokenCiphertext} <> ''`)
    .orderBy(channelFirst('prd'), gateway.createdAt, gateway.id)
    .limit(1);
  if (!oldest) return;

  await db
    .insert(userGateway)
    .values({ profileId, gatewayId: oldest.id, isDefault: true })
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
