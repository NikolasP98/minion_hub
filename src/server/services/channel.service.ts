import { eq, and } from 'drizzle-orm';
import { channels, channelAssignments } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { encrypt, decrypt } from '$server/auth/crypto';
import type { TenantContext } from './base';

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

export async function listChannels(ctx: TenantContext, serverId: string) {
  const rows = await ctx.db
    .select()
    .from(channels)
    .where(and(eq(channels.tenantId, ctx.tenantId), eq(channels.serverId, serverId)))
    .orderBy(channels.createdAt);

  return rows.map((r) => ({
    id: r.id,
    serverId: r.serverId,
    type: r.type as ChannelType,
    label: r.label,
    credentialsMeta: parseMeta(r.credentialsMeta),
    status: r.status as ChannelStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getChannel(ctx: TenantContext, channelId: string, serverId?: string) {
  const conditions = [eq(channels.id, channelId), eq(channels.tenantId, ctx.tenantId)];
  if (serverId) conditions.push(eq(channels.serverId, serverId));

  const [row] = await ctx.db
    .select()
    .from(channels)
    .where(and(...conditions));

  if (!row) return null;

  return {
    id: row.id,
    serverId: row.serverId,
    type: row.type as ChannelType,
    label: row.label,
    credentials: decryptCredentials(row.credentials, row.credentialsIv),
    credentialsMeta: parseMeta(row.credentialsMeta),
    status: row.status as ChannelStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createChannel(ctx: TenantContext, serverId: string, input: ChannelInput) {
  const id = newId();
  const now = nowMs();

  const { ciphertext, iv } = input.credentials
    ? encryptCredentials(input.credentials)
    : { ciphertext: '', iv: '' };

  await ctx.db.insert(channels).values({
    id,
    tenantId: ctx.tenantId,
    serverId,
    type: input.type,
    label: input.label,
    credentials: ciphertext,
    credentialsIv: iv,
    credentialsMeta: JSON.stringify(input.credentialsMeta ?? {}),
    status: input.status ?? 'inactive',
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function updateChannel(
  ctx: TenantContext,
  channelId: string,
  input: Partial<ChannelInput>,
  serverId?: string,
) {
  const now = nowMs();
  const set: Record<string, unknown> = { updatedAt: now };

  if (input.label !== undefined) set.label = input.label;
  if (input.status !== undefined) set.status = input.status;
  if (input.credentialsMeta !== undefined) set.credentialsMeta = JSON.stringify(input.credentialsMeta);

  if (input.credentials !== undefined) {
    const { ciphertext, iv } = encryptCredentials(input.credentials);
    set.credentials = ciphertext;
    set.credentialsIv = iv;
  }

  const conditions = [eq(channels.id, channelId), eq(channels.tenantId, ctx.tenantId)];
  if (serverId) conditions.push(eq(channels.serverId, serverId));

  await ctx.db
    .update(channels)
    .set(set)
    .where(and(...conditions));
}

export async function deleteChannel(ctx: TenantContext, channelId: string, serverId?: string) {
  const conditions = [eq(channels.id, channelId), eq(channels.tenantId, ctx.tenantId)];
  if (serverId) conditions.push(eq(channels.serverId, serverId));

  await ctx.db
    .delete(channels)
    .where(and(...conditions));
}

export async function listChannelAssignments(ctx: TenantContext, channelId: string) {
  return ctx.db
    .select()
    .from(channelAssignments)
    .where(and(eq(channelAssignments.channelId, channelId), eq(channelAssignments.tenantId, ctx.tenantId)))
    .orderBy(channelAssignments.createdAt);
}

export async function assignChannel(
  ctx: TenantContext,
  channelId: string,
  targetType: 'user' | 'session',
  targetId: string,
) {
  const id = newId();
  const now = nowMs();

  await ctx.db
    .insert(channelAssignments)
    .values({ id, tenantId: ctx.tenantId, channelId, targetType, targetId, createdAt: now })
    .onConflictDoNothing();

  return id;
}

export async function unassignChannel(ctx: TenantContext, assignmentId: string) {
  await ctx.db
    .delete(channelAssignments)
    .where(and(eq(channelAssignments.id, assignmentId), eq(channelAssignments.tenantId, ctx.tenantId)));
}
