import { eq, and } from 'drizzle-orm';
import { userAgents } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function assignAgentToUser(
	ctx: TenantContext,
	userId: string,
	agentId: string,
	serverId: string,
) {
	await ctx.db
		.insert(userAgents)
		.values({ userId, agentId, serverId, createdAt: nowMs() })
		.onConflictDoNothing();
}

export async function removeAgentFromUser(
	ctx: TenantContext,
	userId: string,
	agentId: string,
	serverId: string,
) {
	await ctx.db
		.delete(userAgents)
		.where(
			and(
				eq(userAgents.userId, userId),
				eq(userAgents.agentId, agentId),
				eq(userAgents.serverId, serverId),
			),
		);
}

export async function listUserAgentIds(
	ctx: TenantContext,
	userId: string,
	serverId: string,
): Promise<Set<string>> {
	const rows = await ctx.db
		.select({ agentId: userAgents.agentId })
		.from(userAgents)
		.where(and(eq(userAgents.userId, userId), eq(userAgents.serverId, serverId)));
	return new Set(rows.map((r) => r.agentId));
}

export async function listAgentAssignments(
	ctx: TenantContext,
	serverId: string,
) {
	return ctx.db
		.select()
		.from(userAgents)
		.where(eq(userAgents.serverId, serverId));
}

export async function syncUserAgents(
	ctx: TenantContext,
	userId: string,
	serverId: string,
	agentIds: string[],
) {
	// Delete existing assignments for this user+server
	await ctx.db
		.delete(userAgents)
		.where(and(eq(userAgents.userId, userId), eq(userAgents.serverId, serverId)));

	// Insert new assignments
	if (agentIds.length > 0) {
		const now = nowMs();
		await ctx.db.insert(userAgents).values(
			agentIds.map((agentId) => ({
				userId,
				agentId,
				serverId,
				createdAt: now,
			})),
		);
	}
}
