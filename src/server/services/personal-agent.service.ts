import { eq, and, inArray, lt, sql } from 'drizzle-orm';
import { personalAgents } from '$server/db/schema/personal-agents';
import { user } from '$server/db/schema/auth';
import { newId, nowMs } from '$server/db/utils';
import { assignAgentToUser } from './user-agents.service';
import type { TenantContext } from './base';

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonalAgentRow = typeof personalAgents.$inferSelect;
export type ProvisioningStatus = 'pending' | 'provisioning' | 'active' | 'error';
export type PersonalityPreset = 'professional' | 'casual' | 'creative' | 'technical';

export interface PersonalAgentUpdate {
	displayName: string;
	conversationName: string | null;
	personalityPreset: PersonalityPreset | null;
	personalityText: string | null;
	personalityConfigured: boolean;
	avatarUrl: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function derivePersonalAgentId(userId: string): string {
	return `personal-${userId}`;
}

export function deriveDisplayName(userName: string): string {
	return `${userName}'s Agent`;
}

// ── Service Functions ────────────────────────────────────────────────────────

export async function provisionPersonalAgent(
	ctx: TenantContext,
	params: { userId: string; userName: string; serverId: string },
): Promise<PersonalAgentRow> {
	const agentId = derivePersonalAgentId(params.userId);
	const displayName = deriveDisplayName(params.userName);
	const now = nowMs();

	const row: typeof personalAgents.$inferInsert = {
		id: newId(),
		userId: params.userId,
		agentId,
		serverId: params.serverId,
		displayName,
		personalityConfigured: false,
		provisioningStatus: 'pending',
		retryCount: 0,
		createdAt: now,
		updatedAt: now,
	};

	// Insert with onConflictDoNothing for idempotency (userId is unique)
	await ctx.db.insert(personalAgents).values(row).onConflictDoNothing();

	// Update user.personalAgentId for fast lookup
	await ctx.db
		.update(user)
		.set({ personalAgentId: agentId })
		.where(eq(user.id, params.userId));

	// Also insert into user_agents for JWT agentIds compatibility
	await assignAgentToUser(ctx, params.userId, agentId, params.serverId);

	// Return the row (either newly created or existing)
	const [existing] = await ctx.db
		.select()
		.from(personalAgents)
		.where(eq(personalAgents.userId, params.userId))
		.limit(1);

	return existing ?? row;
}

export async function getPersonalAgent(
	ctx: TenantContext,
	userId: string,
): Promise<PersonalAgentRow | null> {
	const rows = await ctx.db
		.select()
		.from(personalAgents)
		.where(eq(personalAgents.userId, userId))
		.limit(1);

	return rows[0] ?? null;
}

export async function updatePersonalAgent(
	ctx: TenantContext,
	userId: string,
	updates: Partial<PersonalAgentUpdate>,
): Promise<void> {
	await ctx.db
		.update(personalAgents)
		.set({
			...updates,
			updatedAt: nowMs(),
		})
		.where(eq(personalAgents.userId, userId));
}

export async function updateProvisioningStatus(
	ctx: TenantContext,
	userId: string,
	status: ProvisioningStatus,
	error?: string,
): Promise<void> {
	const now = nowMs();
	const setData: Record<string, unknown> = {
		provisioningStatus: status,
		updatedAt: now,
	};

	if (status === 'error') {
		setData.provisioningError = error ?? null;
		setData.lastRetryAt = now;
		setData.retryCount = sql`${personalAgents.retryCount} + 1`;
	}

	if (status === 'active') {
		setData.provisioningError = null;
	}

	await ctx.db
		.update(personalAgents)
		.set(setData)
		.where(eq(personalAgents.userId, userId));
}

export async function ensurePersonalAgentOnLogin(
	ctx: TenantContext,
	params: { userId: string; userName: string; serverId: string },
): Promise<PersonalAgentRow> {
	const existing = await getPersonalAgent(ctx, params.userId);
	if (existing) return existing;
	return provisionPersonalAgent(ctx, params);
}

export async function listPendingAgents(
	ctx: TenantContext,
	maxRetries: number = 5,
): Promise<PersonalAgentRow[]> {
	return ctx.db
		.select()
		.from(personalAgents)
		.where(
			and(
				inArray(personalAgents.provisioningStatus, ['pending', 'error']),
				lt(personalAgents.retryCount, maxRetries),
			),
		);
}

export async function deletePersonalAgent(
	ctx: TenantContext,
	userId: string,
): Promise<void> {
	await ctx.db
		.delete(personalAgents)
		.where(eq(personalAgents.userId, userId));
}
