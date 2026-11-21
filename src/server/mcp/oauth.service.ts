/**
 * Storage and rules of the hub's minimal OAuth server (spec 143). Secrets are returned once
 * and stored as SHA-256 hex only. SECURITY BOUNDARY: every lookup here happens before an
 * organization is known, so it runs on the privileged `getCoreDb()` handle; each query filters
 * by hash, id, or the caller's own user/org.
 */
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { profiles } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
import { mcpClients, mcpConnections, mcpCredentials } from '$server/db/pg-org-integrations-schema';
import type { McpConnectionRow } from '$lib/types/mcp-connections';
import { SECRET_PREFIX, hashSecret, newClientId, newSecret, pkceOk } from './oauth-logic';

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

type Db = ReturnType<typeof getCoreDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function registerClient(
  name: string,
  redirectUris: string[],
  ip: string | null,
): Promise<{ id: string }> {
  const id = newClientId();
  await getCoreDb()
    .insert(mcpClients)
    .values({ id, name: name.trim(), redirectUris, createdIp: ip });
  return { id };
}

export async function getClient(
  id: string,
): Promise<{ id: string; name: string; redirectUris: string[]; createdAt: Date } | null> {
  const [hit] = await getCoreDb()
    .select({
      id: mcpClients.id,
      name: mcpClients.name,
      redirectUris: mcpClients.redirectUris,
      createdAt: mcpClients.createdAt,
    })
    .from(mcpClients)
    .where(eq(mcpClients.id, id))
    .limit(1);
  return hit ?? null;
}

/** A single-use authorization code, valid 60 seconds. Returns the secret (shown once). */
export async function createCode(input: {
  clientId: string;
  userId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = newSecret(SECRET_PREFIX.code);
  await getCoreDb()
    .insert(mcpCredentials)
    .values({
      hash: hashSecret(code),
      kind: 'code',
      clientId: input.clientId,
      userId: input.userId,
      orgId: input.orgId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  return code;
}

async function issue(
  db: Db | Tx,
  who: { connectionId: string; clientId: string; userId: string; orgId: string },
): Promise<TokenPair> {
  const access = newSecret(SECRET_PREFIX.access);
  const refresh = newSecret(SECRET_PREFIX.refresh);
  const base = {
    connectionId: who.connectionId,
    clientId: who.clientId,
    userId: who.userId,
    orgId: who.orgId,
  };
  await db.insert(mcpCredentials).values([
    {
      ...base,
      hash: hashSecret(access),
      kind: 'access',
      expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    },
    {
      ...base,
      hash: hashSecret(refresh),
      kind: 'refresh',
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  ]);
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
  };
}

/** A connection can be renewed for 180 days from its approval, and only while it is not ended (P15). */
const connectionRenewable = sql`${mcpCredentials.connectionId} in (
  select id from mcp_connections
  where revoked_at is null and approved_at > now() - interval '180 days')`;

/** End a connection (idempotent): every credential of it stops working at once. */
const endById = (db: Db | Tx, connectionId: string) =>
  db
    .update(mcpConnections)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(mcpConnections.id, connectionId), isNull(mcpConnections.revokedAt)));

/**
 * Spend a code and open one connection. The spend is its own committed statement (P3): a
 * failed check afterwards leaves the code spent, never rolled back. Presenting a spent code
 * again ends the connection it opened (P11). Null = invalid_grant.
 */
export async function exchangeCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
}): Promise<TokenPair | null> {
  const db = getCoreDb();
  const hash = hashSecret(input.code);
  const [row] = await db
    .update(mcpCredentials)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(mcpCredentials.hash, hash),
        eq(mcpCredentials.kind, 'code'),
        isNull(mcpCredentials.usedAt),
        gt(mcpCredentials.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!row) {
    const [old] = await db
      .select({ connectionId: mcpCredentials.connectionId, usedAt: mcpCredentials.usedAt })
      .from(mcpCredentials)
      .where(and(eq(mcpCredentials.hash, hash), eq(mcpCredentials.kind, 'code')))
      .limit(1);
    if (old?.usedAt && old.connectionId) await endById(db, old.connectionId);
    return null;
  }
  if (
    row.clientId !== input.clientId ||
    row.redirectUri !== input.redirectUri ||
    !row.codeChallenge ||
    !pkceOk(input.verifier, row.codeChallenge)
  )
    return null;
  return db.transaction(async (tx) => {
    const [conn] = await tx
      .insert(mcpConnections)
      .values({ userId: row.userId, clientId: row.clientId, orgId: row.orgId })
      .returning({ id: mcpConnections.id });
    // The code remembers its connection, so a replay can end it (P11).
    await tx
      .update(mcpCredentials)
      .set({ connectionId: conn!.id })
      .where(eq(mcpCredentials.hash, hash));
    return issue(tx, { ...row, connectionId: conn!.id });
  });
}

/** A renewal credential may be presented again this long after its use (a retry), once (P2). */
export const RENEW_GRACE_SECONDS = 30;

/**
 * Trade a renewal credential for a new pair. The spend is its own statement and already
 * requires the presenting app and a live, in-lifetime connection (P3, P15), so a mismatched
 * request burns nothing. Presented again within 30 s of its use it gets ONE fresh pair (a retry
 * or a parallel session), claimed by a conditional update on `regranted_at`; any other reuse
 * ends the connection. Null = invalid_grant.
 */
export async function refresh(input: {
  token: string;
  clientId: string;
}): Promise<TokenPair | null> {
  const db = getCoreDb();
  const hash = hashSecret(input.token);
  const [row] = await db
    .update(mcpCredentials)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(mcpCredentials.hash, hash),
        eq(mcpCredentials.kind, 'refresh'),
        eq(mcpCredentials.clientId, input.clientId),
        isNull(mcpCredentials.usedAt),
        gt(mcpCredentials.expiresAt, sql`now()`),
        connectionRenewable,
      ),
    )
    .returning();
  if (row?.connectionId) return issue(db, { ...row, connectionId: row.connectionId });

  const [old] = await db
    .select({ connectionId: mcpCredentials.connectionId, usedAt: mcpCredentials.usedAt })
    .from(mcpCredentials)
    .where(
      and(
        eq(mcpCredentials.hash, hash),
        eq(mcpCredentials.kind, 'refresh'),
        eq(mcpCredentials.clientId, input.clientId),
      ),
    )
    .limit(1);
  if (!old?.usedAt || !old.connectionId) return null;
  const [grace] = await db
    .update(mcpCredentials)
    .set({ regrantedAt: sql`now()` })
    .where(
      and(
        eq(mcpCredentials.hash, hash),
        isNull(mcpCredentials.regrantedAt),
        sql`${mcpCredentials.usedAt} > now() - make_interval(secs => ${RENEW_GRACE_SECONDS})`,
      ),
    )
    .returning();
  if (!grace) {
    await endById(db, old.connectionId);
    return null;
  }
  const [live] = await db
    .select({ id: mcpConnections.id })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.id, old.connectionId),
        isNull(mcpConnections.revokedAt),
        sql`${mcpConnections.approvedAt} > now() - interval '180 days'`,
      ),
    )
    .limit(1);
  return live ? issue(db, { ...grace, connectionId: old.connectionId }) : null;
}

/**
 * Housekeeping, run on about 1% of token-endpoint calls (P9): credentials expired over a day
 * ago, and apps registered over a day ago that nobody ever approved.
 * TODO(handoff): apps that still have a connection are never pruned; add an unused-for-90-days
 * rule once `mcp_clients` records a last-used time.
 */
export async function pruneOauth(): Promise<void> {
  const db = getCoreDb();
  await db
    .delete(mcpCredentials)
    .where(lt(mcpCredentials.expiresAt, sql`now() - interval '1 day'`));
  await db
    .delete(mcpClients)
    .where(
      and(
        lt(mcpClients.createdAt, sql`now() - interval '1 day'`),
        sql`not exists (select 1 from mcp_connections c where c.client_id = ${mcpClients.id})`,
      ),
    );
}

export interface McpAccess {
  connectionId: string;
  userId: string;
  orgId: string;
  lastUsedAt: Date | null;
}

/** The live connection behind an unexpired access credential, or null. */
export async function findAccess(secret: string): Promise<McpAccess | null> {
  const [hit] = await getCoreDb()
    .select({
      connectionId: mcpConnections.id,
      userId: mcpConnections.userId,
      orgId: mcpConnections.orgId,
      lastUsedAt: mcpConnections.lastUsedAt,
    })
    .from(mcpCredentials)
    .innerJoin(mcpConnections, eq(mcpConnections.id, mcpCredentials.connectionId))
    .where(
      and(
        eq(mcpCredentials.hash, hashSecret(secret)),
        eq(mcpCredentials.kind, 'access'),
        gt(mcpCredentials.expiresAt, sql`now()`),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .limit(1);
  return hit ?? null;
}

/** Record a use; the condition keeps it to at most one write per connection and minute. */
export async function touchConnection(id: string): Promise<void> {
  await getCoreDb()
    .update(mcpConnections)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(mcpConnections.id, id),
        or(
          isNull(mcpConnections.lastUsedAt),
          lt(mcpConnections.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
}

/**
 * End a live connection (and with it every credential: the call path and `refresh` both check
 * it). `scope` restricts to the caller's own connections or to one organization.
 */
export async function endConnection(
  id: string,
  by: string | null,
  scope: { userId: string } | { orgId: string } | null = null,
): Promise<boolean> {
  const where = [eq(mcpConnections.id, id), isNull(mcpConnections.revokedAt)];
  if (scope && 'userId' in scope) where.push(eq(mcpConnections.userId, scope.userId));
  if (scope && 'orgId' in scope) where.push(eq(mcpConnections.orgId, scope.orgId));
  const ended = await getCoreDb()
    .update(mcpConnections)
    .set({ revokedAt: sql`now()`, revokedBy: by })
    .where(and(...where))
    .returning({ id: mcpConnections.id });
  return ended.length > 0;
}

/**
 * End every live connection of a person in one organization (member removal): a person who
 * is later added back must approve each app again (spec 143 audit 3).
 */
export async function endConnectionsForMember(orgId: string, userId: string): Promise<number> {
  const ended = await getCoreDb()
    .update(mcpConnections)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(mcpConnections.orgId, orgId),
        eq(mcpConnections.userId, userId),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .returning({ id: mcpConnections.id });
  return ended.length;
}

/** Live connections of one organization: only the viewer's own, or every one with `all`. */
export async function listConnections(
  orgId: string,
  viewerId: string,
  all: boolean,
): Promise<McpConnectionRow[]> {
  const rows = await getCoreDb()
    .select({
      id: mcpConnections.id,
      userId: mcpConnections.userId,
      appName: mcpClients.name,
      approvedAt: mcpConnections.approvedAt,
      lastUsedAt: mcpConnections.lastUsedAt,
      displayName: profiles.displayName,
      email: profiles.email,
    })
    .from(mcpConnections)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpConnections.clientId))
    .leftJoin(profiles, eq(profiles.id, mcpConnections.userId))
    .where(
      and(
        eq(mcpConnections.orgId, orgId),
        isNull(mcpConnections.revokedAt),
        all ? undefined : eq(mcpConnections.userId, viewerId),
      ),
    )
    .orderBy(desc(mcpConnections.approvedAt));
  return rows.map((r) => ({
    id: r.id,
    appName: r.appName,
    personName: r.displayName || r.email || null,
    mine: r.userId === viewerId,
    approvedAt: r.approvedAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}
