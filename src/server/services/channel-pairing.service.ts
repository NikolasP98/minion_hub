/**
 * DB-backed channel pairing — the hub side of moving the gateway's
 * `<channel>-pairing.json` files into `channel_pairing_requests` (json store removed in
 * favor of the DB). The gateway reaches these via /api/internal/channels/pairing/*
 * (thin-gateway HTTP; gateway holds no DB creds).
 *
 * Division of labor: the GATEWAY owns the crypto (generates the code, SHA-256-hashes it
 * via token-hash.ts, verifies on approve) — the hub only STORES the hash and writes the
 * approved sender into channels.allow_from. So the hub does no code generation/verify.
 *
 * Scoping: getCoreDb() is the service-role (BYPASSRLS) connection; we scope manually by
 * gateway_id and resolve tenant_id from the owning channels row.
 */
import { and, asc, eq, lt } from 'drizzle-orm';
import { channels, channelPairingRequests } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';

const PAIRING_TTL_MS = 60 * 60 * 1000; // mirrors gateway PAIRING_PENDING_TTL_MS
const PAIRING_MAX_PENDING = 3; // mirrors gateway PAIRING_PENDING_MAX

export type PairingScope = {
  gatewayId: string;
  channelType: string;
  accountId: string;
};

export type PairingRow = {
  id: string;
  senderId: string;
  codeHash: string;
  meta: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
};

/** Resolve the owning org for a (gateway, type, account) channel. null = unknown channel. */
async function resolveTenantId(scope: PairingScope): Promise<string | null> {
  const [row] = await getCoreDb()
    .select({ tenantId: channels.tenantId })
    .from(channels)
    .where(
      and(
        eq(channels.gatewayId, scope.gatewayId),
        eq(channels.type, scope.channelType as 'whatsapp' | 'telegram' | 'discord'),
        eq(channels.accountId, scope.accountId),
      ),
    )
    .limit(1);
  return row?.tenantId ?? null;
}

function scopeWhere(scope: PairingScope) {
  return and(
    eq(channelPairingRequests.gatewayId, scope.gatewayId),
    eq(channelPairingRequests.channelType, scope.channelType),
    eq(channelPairingRequests.accountId, scope.accountId),
  );
}

/** Drop requests older than the TTL for this scope (lazy prune, like the json store). */
async function pruneExpired(scope: PairingScope): Promise<void> {
  const cutoff = new Date(Date.now() - PAIRING_TTL_MS);
  await getCoreDb()
    .delete(channelPairingRequests)
    .where(and(scopeWhere(scope), lt(channelPairingRequests.createdAt, cutoff)));
}

export async function listPairingRequests(scope: PairingScope): Promise<PairingRow[]> {
  await pruneExpired(scope);
  const rows = await getCoreDb()
    .select({
      id: channelPairingRequests.id,
      senderId: channelPairingRequests.senderId,
      codeHash: channelPairingRequests.codeHash,
      meta: channelPairingRequests.meta,
      createdAt: channelPairingRequests.createdAt,
      lastSeenAt: channelPairingRequests.lastSeenAt,
    })
    .from(channelPairingRequests)
    .where(scopeWhere(scope))
    .orderBy(asc(channelPairingRequests.createdAt));
  return rows.map((r) => ({
    id: r.id,
    senderId: r.senderId,
    codeHash: r.codeHash,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

/**
 * Create or refresh a pending request. The gateway has already generated+hashed the code.
 * Mirrors the json store: refresh an existing sender's row; otherwise create unless the
 * per-account pending cap is hit. Returns whether a NEW row was created (the gateway only
 * sends the pairing reply on `created`).
 */
export async function upsertPairingRequest(
  scope: PairingScope,
  input: { senderId: string; codeHash: string; meta?: Record<string, unknown> },
): Promise<{ created: boolean }> {
  const tenantId = await resolveTenantId(scope);
  if (!tenantId) return { created: false }; // unknown channel → no-op (gateway falls back)
  await pruneExpired(scope);
  const db = getCoreDb();

  const [existing] = await db
    .select({ id: channelPairingRequests.id })
    .from(channelPairingRequests)
    .where(and(scopeWhere(scope), eq(channelPairingRequests.senderId, input.senderId)))
    .limit(1);

  if (existing) {
    await db
      .update(channelPairingRequests)
      .set({ codeHash: input.codeHash, lastSeenAt: new Date(), meta: input.meta ?? {} })
      .where(eq(channelPairingRequests.id, existing.id));
    return { created: false };
  }

  const pending = await db
    .select({ id: channelPairingRequests.id })
    .from(channelPairingRequests)
    .where(scopeWhere(scope));
  if (pending.length >= PAIRING_MAX_PENDING) return { created: false };

  await db.insert(channelPairingRequests).values({
    tenantId,
    gatewayId: scope.gatewayId,
    channelType: scope.channelType,
    accountId: scope.accountId,
    senderId: input.senderId,
    codeHash: input.codeHash,
    meta: input.meta ?? {},
  });
  return { created: true };
}

/**
 * Approve a sender (the gateway already verified the code locally): add the sender to
 * channels.allow_from (dedup) and delete the pending request. Read-modify-write on
 * allow_from — pairing approvals are rare and serial, so no atomic-append needed.
 */
export async function approvePairingRequest(
  scope: PairingScope,
  senderId: string,
): Promise<{ approved: boolean }> {
  const db = getCoreDb();
  const [chan] = await db
    .select({ id: channels.id, allowFrom: channels.allowFrom })
    .from(channels)
    .where(
      and(
        eq(channels.gatewayId, scope.gatewayId),
        eq(channels.type, scope.channelType as 'whatsapp' | 'telegram' | 'discord'),
        eq(channels.accountId, scope.accountId),
      ),
    )
    .limit(1);
  if (!chan) return { approved: false };

  if (!chan.allowFrom.includes(senderId)) {
    await db
      .update(channels)
      .set({ allowFrom: [...chan.allowFrom, senderId], updatedAt: new Date() })
      .where(eq(channels.id, chan.id));
  }
  await db
    .delete(channelPairingRequests)
    .where(and(scopeWhere(scope), eq(channelPairingRequests.senderId, senderId)));
  return { approved: true };
}
