import { eq, and } from 'drizzle-orm';
import { channelIdentities, user } from '$server/db/schema';
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
 * List all channel identity mappings.
 * Used by the gateway on startup to fetch the full mapping table.
 */
export async function listChannelIdentities(
	ctx: TenantContext,
): Promise<ChannelIdentityEntry[]> {
	// Join through user to scope by tenant (users belong to orgs via member table,
	// but for simplicity we return all channel identities -- the gateway filters by its own users)
	const rows = await ctx.db
		.select({
			id: channelIdentities.id,
			userId: channelIdentities.userId,
			channel: channelIdentities.channel,
			channelUserId: channelIdentities.channelUserId,
			displayName: channelIdentities.displayName,
			verifiedAt: channelIdentities.verifiedAt,
			createdAt: channelIdentities.createdAt,
		})
		.from(channelIdentities);

	return rows;
}

/**
 * Get channel identities for a specific user.
 */
export async function getChannelIdentitiesForUser(
	ctx: TenantContext,
	userId: string,
): Promise<ChannelIdentityEntry[]> {
	return ctx.db
		.select({
			id: channelIdentities.id,
			userId: channelIdentities.userId,
			channel: channelIdentities.channel,
			channelUserId: channelIdentities.channelUserId,
			displayName: channelIdentities.displayName,
			verifiedAt: channelIdentities.verifiedAt,
			createdAt: channelIdentities.createdAt,
		})
		.from(channelIdentities)
		.where(eq(channelIdentities.userId, userId));
}

/**
 * Link a channel identity to a user.
 * Upserts on (channel, channelUserId) unique constraint.
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
		.insert(channelIdentities)
		.values({
			id,
			userId: params.userId,
			channel: params.channel,
			channelUserId: params.channelUserId,
			displayName: params.displayName ?? null,
			createdAt: now,
		})
		.onConflictDoUpdate({
			target: [channelIdentities.channel, channelIdentities.channelUserId],
			set: {
				userId: params.userId,
				displayName: params.displayName ?? null,
			},
		});

	return id;
}

/**
 * Unlink a channel identity by ID.
 */
export async function unlinkChannelIdentity(
	ctx: TenantContext,
	id: string,
): Promise<void> {
	await ctx.db
		.delete(channelIdentities)
		.where(eq(channelIdentities.id, id));
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
		.delete(channelIdentities)
		.where(
			and(
				eq(channelIdentities.userId, userId),
				eq(channelIdentities.channel, channel),
			),
		);
}
