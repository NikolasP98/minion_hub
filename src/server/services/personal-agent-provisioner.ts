import type { PersonalAgentRow } from './personal-agent.service';
import { getPersonalAgent, updateProvisioningStatus } from './personal-agent.service';
import type { TenantContext } from './base';

const MAX_RETRIES = 5;
// Backoff: 5s, 30s, 2min, 10min, 10min
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 600_000];

export function getBackoffDelay(retryCount: number): number {
	return BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
}

export function shouldRetryAgent(agent: PersonalAgentRow, nowMs?: number): boolean {
	const now = nowMs ?? Date.now();
	if (agent.provisioningStatus === 'active') return false;
	if (agent.provisioningStatus === 'provisioning') return false;
	if (agent.retryCount >= MAX_RETRIES) return false;
	if (agent.provisioningStatus !== 'pending' && agent.provisioningStatus !== 'error') return false;
	// Respect backoff delay
	if (agent.lastRetryAt) {
		const nextRetryAt = agent.lastRetryAt + getBackoffDelay(agent.retryCount);
		if (now < nextRetryAt) return false;
	}
	return true;
}

/**
 * Build the params for a gateway `agents.create` WebSocket call.
 * IMPORTANT: Always includes agentType: 'standard' per PA-01 locked decision.
 */
export function getProvisioningPayload(agent: PersonalAgentRow): {
	name: string;
	agentId: string;
	agentType: 'standard';
} {
	return {
		name: agent.displayName,
		agentId: agent.agentId,
		agentType: 'standard',
	};
}

/**
 * Check if the current user has a personal agent that needs provisioning.
 * Returns the agent row if it needs a gateway call, null otherwise.
 * Called from the provision API endpoint to signal the client to
 * trigger provisioning via sendRequest('agents.create').
 */
export async function getPendingProvisioningForUser(
	ctx: TenantContext,
	userId: string,
): Promise<{ agent: PersonalAgentRow; payload: ReturnType<typeof getProvisioningPayload> } | null> {
	const agent = await getPersonalAgent(ctx, userId);
	if (!agent) return null;
	if (!shouldRetryAgent(agent)) return null;
	return { agent, payload: getProvisioningPayload(agent) };
}

/**
 * Mark an agent as provisioning (called server-side before client makes the gateway call).
 */
export async function markProvisioning(ctx: TenantContext, userId: string): Promise<void> {
	await updateProvisioningStatus(ctx, userId, 'provisioning');
}

/**
 * Mark an agent as active (called from client-side API after successful agents.create).
 */
export async function markActive(ctx: TenantContext, userId: string): Promise<void> {
	await updateProvisioningStatus(ctx, userId, 'active');
}

/**
 * Mark an agent as error (called from client-side API after failed agents.create).
 */
export async function markError(ctx: TenantContext, userId: string, error: string): Promise<void> {
	await updateProvisioningStatus(ctx, userId, 'error', error);
}
