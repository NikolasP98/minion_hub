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
 * Get channel identities for a specific user — from the canonical Supabase
 * `user_identities` vault (keyed by profile uuid, resolved from the passed
 * legacy id or uuid). The Turso `ctx` is no longer read here; the param is kept
 * for call-site compatibility. Dynamic import avoids a service import cycle.
 */
export async function getChannelIdentitiesForUser(
  _ctx: TenantContext,
  userId: string,
): Promise<ChannelIdentityEntry[]> {
  const { listChannelIdentitiesFromSupabase } = await import('./supabase-credential');
  return listChannelIdentitiesFromSupabase(userId);
}

/** A channel identity enriched with the owning hub user's name (for pickers). */
export interface ChannelIdentityPick {
  id: string;
  channel: string;
  channelUserId: string;
  displayName: string | null;
  userName: string | null;
  verifiedAt: number | null;
}

/**
 * List channel identities joined with the owning hub user's name — for the flow
 * editor's "Registered" destination picker, which shows WHO (the person), not
 * the raw channel id. Label preference downstream: channel displayName → user
 * name → channelUserId.
 */
export async function listChannelIdentitiesForPicker(
  ctx: TenantContext,
): Promise<ChannelIdentityPick[]> {
  const rows = await ctx.db
    .select({
      id: userIdentities.id,
      userId: userIdentities.userId,
      channel: userIdentities.provider,
      channelUserId: userIdentities.externalId,
      displayName: userIdentities.displayName,
      verifiedAt: userIdentities.verifiedAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.kind, 'channel'));

  // Name source: a user's OAuth/channel identity carries their name or email in
  // display_name. Resolve a best-effort name per user from any identity so the
  // picker shows a person, not a raw channel id. (The legacy Turso `user` join
  // was removed — Supabase is the identity store; this display_name fallback is
  // what was already powering names in Supabase-primary mode anyway.)
  const all = await ctx.db
    .select({
      userId: userIdentities.userId,
      kind: userIdentities.kind,
      displayName: userIdentities.displayName,
    })
    .from(userIdentities);
  const nameByUser = new Map<string, string>();
  for (const n of all) {
    const dn = n.displayName?.trim();
    if (!dn) continue;
    // Prefer a non-channel (e.g. oauth) name; don't let a channel row clobber it.
    if (!nameByUser.has(n.userId) || n.kind !== 'channel') nameByUser.set(n.userId, dn);
  }

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    channelUserId: r.channelUserId,
    displayName: r.displayName,
    userName: nameByUser.get(r.userId) ?? null,
    verifiedAt: r.verifiedAt,
  }));
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
