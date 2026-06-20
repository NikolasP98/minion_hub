import { eq, and } from 'drizzle-orm';
import { channels, channelAssignments } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import { encrypt, decrypt } from '$server/auth/crypto';
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
  credentials?: Record<string, string>;
  credentialsMeta?: Record<string, string>;
  status?: ChannelStatus;
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

  await withOrgCore(ctx, (tx) =>
    tx.insert(channels).values({
      id,
      tenantId: ctx.tenantId,
      gatewayId: ctx.gatewayId,
      type: input.type,
      label: input.label,
      credentials: ciphertext,
      credentialsIv: iv,
      credentialsMeta: JSON.stringify(input.credentialsMeta ?? {}),
      status: input.status ?? 'inactive',
    }),
  );

  return id;
}

export async function updateChannel(
  ctx: ServerCtx,
  channelId: string,
  input: Partial<ChannelInput>,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.label !== undefined) set.label = input.label;
  if (input.status !== undefined) set.status = input.status;
  if (input.credentialsMeta !== undefined)
    set.credentialsMeta = JSON.stringify(input.credentialsMeta);

  if (input.credentials !== undefined) {
    const { ciphertext, iv } = encryptCredentials(input.credentials);
    set.credentials = ciphertext;
    set.credentialsIv = iv;
  }

  await withOrgCore(ctx, (tx) =>
    tx
      .update(channels)
      .set(set)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.tenantId, ctx.tenantId),
          eq(channels.gatewayId, ctx.gatewayId),
        ),
      ),
  );
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
