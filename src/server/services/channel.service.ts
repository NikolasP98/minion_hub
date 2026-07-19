import { eq, and, ne, sql } from 'drizzle-orm';
import { channels, channelAssignments } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import { encrypt, decrypt } from '$server/auth/crypto';
import { reconcileOrgConfigSafe } from './org-config-sync.service';
import type { ServerCtx } from '$server/auth/core-ctx';

export type ChannelType = 'discord' | 'whatsapp' | 'telegram';
export type ChannelStatus = 'active' | 'inactive' | 'pairing';

const VALID_TYPES = new Set<string>(['discord', 'whatsapp', 'telegram']);
const VALID_STATUSES = new Set<string>(['active', 'inactive', 'pairing']);
const VALID_TARGET_TYPES = new Set<string>(['user', 'session']);

export function isValidChannelType(v: string): v is ChannelType {
  return VALID_TYPES.has(v);
}
export function isValidChannelStatus(v: string): v is ChannelStatus {
  return VALID_STATUSES.has(v);
}
export function isValidTargetType(v: string): v is 'user' | 'session' {
  return VALID_TARGET_TYPES.has(v);
}

export interface ChannelInput {
  type: ChannelType;
  label: string;
  /** Gateway account key (phone/handle, e.g. "+51992376833") — the join to the gateway's
   * per-account config. Set after pairing discovers the phone so the channel stops being
   * keyed by its opaque id (which otherwise orphans the row + spawns a duplicate on import). */
  accountId?: string;
  credentials?: Record<string, string>;
  credentialsMeta?: Record<string, string>;
  status?: ChannelStatus;
  /** Runtime enable/disable. DB-authoritative — the gateway mirror reads it. */
  enabled?: boolean;
  /** Reply intent: 'none' = listen-only (ingest, never emit); 'bound' = may reply
   * where allowFrom matches. DB-authoritative; drives the gateway's listen-only
   * kill-switch via the mirror. */
  replies?: 'none' | 'bound';
  /** DM access list: ['*'] = open (reply to anyone), specific entries = allowlist,
   * [] = nobody. E.164 with '+'. */
  allowFrom?: string[];
  /** Group access list (same semantics as allowFrom, for group chats). */
  groupAllowFrom?: string[];
  /** Set ⇒ the account is USER-scoped: it belongs to this person and follows them
   * across orgs (tenantId stays the "home" org). Null ⇒ org-scoped via tenantId.
   * Callers must derive this from the session, never from request input. */
  ownerProfileId?: string;
  /** Require an @mention to reply in groups. */
  requireMention?: boolean;
}

function encryptCredentials(creds: Record<string, string>): { ciphertext: string; iv: string } {
  const json = JSON.stringify(creds);
  return encrypt(json);
}

function decryptCredentials(ciphertext: string, iv: string): Record<string, string> {
  if (!ciphertext || !iv) return {};
  try {
    return JSON.parse(decrypt(ciphertext, iv));
  } catch {
    return {};
  }
}

function parseMeta(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function listChannels(ctx: ServerCtx) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, ctx.tenantId), eq(channels.gatewayId, ctx.gatewayId)))
      .orderBy(channels.createdAt),
  );

  return rows.map((r) => ({
    id: r.id,
    serverId: ctx.serverId,
    type: r.type as ChannelType,
    label: r.label,
    accountId: r.accountId,
    credentialsMeta: parseMeta(r.credentialsMeta),
    status: r.status as ChannelStatus,
    enabled: r.enabled,
    // Derived reply mode (linked-channels restructure): 'none' = receive-only, 'bound' = auto-reply.
    replies: r.replies as 'none' | 'bound',
    allowFrom: r.allowFrom ?? [],
    groupAllowFrom: r.groupAllowFrom ?? [],
    requireMention: r.requireMention ?? false,
    lastError: r.lastError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getChannel(ctx: ServerCtx, channelId: string) {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.tenantId, ctx.tenantId),
          eq(channels.gatewayId, ctx.gatewayId),
        ),
      ),
  );

  if (!row) return null;

  return {
    id: row.id,
    serverId: ctx.serverId,
    type: row.type as ChannelType,
    accountId: row.accountId,
    label: row.label,
    credentials: decryptCredentials(row.credentials, row.credentialsIv),
    credentialsMeta: parseMeta(row.credentialsMeta),
    status: row.status as ChannelStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createChannel(ctx: ServerCtx, input: ChannelInput) {
  const id = newId();

  const { ciphertext, iv } = input.credentials
    ? encryptCredentials(input.credentials)
    : { ciphertext: '', iv: '' };

  await withOrgCore(ctx, async (tx) => {
    await tx.insert(channels).values({
      id,
      tenantId: ctx.tenantId,
      gatewayId: ctx.gatewayId,
      type: input.type,
      // Phone/handle when already known (e.g. wizard pre-pair) so the row is keyed by
      // the gateway account from birth; null for opaque-first channels that bind on pair.
      accountId: input.accountId ?? null,
      label: input.label,
      credentials: ciphertext,
      credentialsIv: iv,
      credentialsMeta: JSON.stringify(input.credentialsMeta ?? {}),
      status: input.status ?? 'inactive',
      // Access rules (Phase 4: DB-authoritative, mirrored to the gateway via
      // publishChannel — no longer written to gateway.json). Column defaults
      // ('none' / []) apply when the caller doesn't collect these yet.
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.replies !== undefined ? { replies: input.replies } : {}),
      ...(input.allowFrom !== undefined ? { allowFrom: input.allowFrom } : {}),
      ...(input.groupAllowFrom !== undefined ? { groupAllowFrom: input.groupAllowFrom } : {}),
      ...(input.requireMention !== undefined ? { requireMention: input.requireMention } : {}),
    });
    // owner_profile_id is written raw: the hub consumes @minion-stack/db as a vendored
    // tarball, so the column isn't in its Drizzle types yet (same workaround as
    // org-config-sync.service). Swap to channels.ownerProfileId once the pkg is repacked.
    if (input.ownerProfileId) {
      await tx.execute(
        sql`update channels set owner_profile_id = ${input.ownerProfileId} where id = ${id}`,
      );
    }
  });

  // Adding the row sets this account's org ownership — push the updated
  // accountOrgs to the gateway now so the account is org-scoped immediately,
  // not cross-org-visible until the hourly tick. Mirrors deleteChannel.
  await reconcileOrgConfigSafe(ctx.gatewayId);

  return id;
}

export async function updateChannel(
  ctx: ServerCtx,
  channelId: string,
  input: Partial<ChannelInput>,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.label !== undefined) set.label = input.label;
  if (input.accountId !== undefined) set.accountId = input.accountId;
  if (input.status !== undefined) set.status = input.status;
  if (input.enabled !== undefined) set.enabled = input.enabled;
  if (input.replies !== undefined) set.replies = input.replies;
  if (input.allowFrom !== undefined) set.allowFrom = input.allowFrom;
  if (input.groupAllowFrom !== undefined) set.groupAllowFrom = input.groupAllowFrom;
  if (input.requireMention !== undefined) set.requireMention = input.requireMention;
  if (input.credentialsMeta !== undefined)
    set.credentialsMeta = JSON.stringify(input.credentialsMeta);

  if (input.credentials !== undefined) {
    const { ciphertext, iv } = encryptCredentials(input.credentials);
    set.credentials = ciphertext;
    set.credentialsIv = iv;
  }

  await withOrgCore(ctx, async (tx) => {
    // Binding account_id (phone) can collide with a row a prior gateway import
    // already created for the same phone — the orphan/duplicate this whole fix
    // targets. Fold it in: delete the duplicate (its bindings/assignments cascade)
    // so this row becomes the single canonical one and the unique
    // (tenant, gateway, type, account_id) index isn't violated.
    if (typeof set.accountId === 'string' && set.accountId) {
      await tx
        .delete(channels)
        .where(
          and(
            eq(channels.tenantId, ctx.tenantId),
            eq(channels.gatewayId, ctx.gatewayId),
            eq(channels.accountId, set.accountId as string),
            ne(channels.id, channelId),
          ),
        );
    }
    await tx
      .update(channels)
      .set(set)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.tenantId, ctx.tenantId),
          eq(channels.gatewayId, ctx.gatewayId),
        ),
      );
  });
}

export async function deleteChannel(ctx: ServerCtx, channelId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(channels)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.tenantId, ctx.tenantId),
          eq(channels.gatewayId, ctx.gatewayId),
        ),
      ),
  );
  // Removing the row drops this account's org ownership — push the updated
  // accountOrgs to the gateway now (don't wait for the hourly tick).
  await reconcileOrgConfigSafe(ctx.gatewayId);
}

export async function listChannelAssignments(ctx: ServerCtx, channelId: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(channelAssignments)
      .where(
        and(
          eq(channelAssignments.channelId, channelId),
          eq(channelAssignments.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(channelAssignments.createdAt),
  );
}

export async function assignChannel(
  ctx: ServerCtx,
  channelId: string,
  targetType: 'user' | 'session',
  targetId: string,
) {
  const id = newId();

  await withOrgCore(ctx, (tx) =>
    tx
      .insert(channelAssignments)
      .values({ id, tenantId: ctx.tenantId, channelId, targetType, targetId })
      .onConflictDoNothing(),
  );

  return id;
}

export async function unassignChannel(ctx: ServerCtx, assignmentId: string) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(channelAssignments)
      .where(
        and(eq(channelAssignments.id, assignmentId), eq(channelAssignments.tenantId, ctx.tenantId)),
      ),
  );
}
