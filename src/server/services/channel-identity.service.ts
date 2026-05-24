import { eq, and } from 'drizzle-orm';
import { userIdentities } from '../db/schema/user-identities';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

/** A channel identity entry as returned by the service. */
export interface ChannelIdentityEntry {
  id: string;
  userId: string;
  channel: string;
  channelUserId: string;
  displayName: string | null;
  verifiedAt: number | null;
  createdAt: number;
}

/**
 * Channel identities are stored in the unified `user_identities` table with
 * kind='channel' (provider=<channel>, externalId=<channelUserId>). These
 * projections preserve the legacy ChannelIdentityEntry shape the gateway
 * consumes, so the channel→user mapping keeps working unchanged.
 */
const channelProjection = {
  id: userIdentities.id,
  userId: userIdentities.userId,
  channel: userIdentities.provider,
  channelUserId: userIdentities.externalId,
  displayName: userIdentities.displayName,
  verifiedAt: userIdentities.verifiedAt,
  createdAt: userIdentities.createdAt,
};

/**
 * List all channel identity mappings.
 * Used by the gateway on startup to fetch the full mapping table.
 */
export async function listChannelIdentities(ctx: TenantContext): Promise<ChannelIdentityEntry[]> {
  return ctx.db
    .select(channelProjection)
    .from(userIdentities)
    .where(eq(userIdentities.kind, 'channel'));
}

/**
 * Get channel identities for a specific user.
 */
export async function getChannelIdentitiesForUser(
  ctx: TenantContext,
  userId: string,
): Promise<ChannelIdentityEntry[]> {
  return ctx.db
    .select(channelProjection)
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.kind, 'channel')));
}

/**
 * Link a channel identity to a user.
 * Upserts on (provider, externalId) unique constraint.
 */
export async function linkChannelIdentity(
  ctx: TenantContext,
  params: {
    userId: string;
    channel: string;
    channelUserId: string;
    displayName?: string;
  },
): Promise<string> {
  const id = newId();
  const now = nowMs();

  await ctx.db
    .insert(userIdentities)
    .values({
      id,
      userId: params.userId,
      provider: params.channel,
      kind: 'channel',
      externalId: params.channelUserId,
      displayName: params.displayName ?? null,
      scope: null,
      secretCiphertext: null,
      secretIv: null,
      expiresAt: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.externalId],
      set: {
        userId: params.userId,
        displayName: params.displayName ?? null,
        updatedAt: now,
      },
    });

  return id;
}

/**
 * Unlink a channel identity by ID.
 */
export async function unlinkChannelIdentity(ctx: TenantContext, id: string): Promise<void> {
  await ctx.db.delete(userIdentities).where(eq(userIdentities.id, id));
}

/**
 * Unlink all channel identities for a user on a specific channel.
 */
export async function unlinkChannelIdentitiesByChannel(
  ctx: TenantContext,
  userId: string,
  channel: string,
): Promise<void> {
  await ctx.db
    .delete(userIdentities)
    .where(
      and(
        eq(userIdentities.userId, userId),
        eq(userIdentities.kind, 'channel'),
        eq(userIdentities.provider, channel),
      ),
    );
}
