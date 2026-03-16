/**
 * Hub-side migration service for adopting existing de facto personal agents
 * into the formal personal agent system.
 *
 * Called after the gateway-side migration (directory rename + symlink + config update)
 * is complete. Creates the hub DB entries (personal_agents + user_agents) so the
 * migrated agent is fully integrated.
 */
import type { PersonalAgentRow } from './personal-agent.service';
import {
	provisionPersonalAgent,
	updateProvisioningStatus,
	updatePersonalAgent,
} from './personal-agent.service';
import type { TenantContext } from './base';

/**
 * Create hub DB entries for a migrated personal agent.
 *
 * Flow:
 * 1. provisionPersonalAgent creates personal_agents + user_agents rows (status 'pending')
 * 2. updateProvisioningStatus transitions to 'active' (workspace already exists from migration)
 * 3. updatePersonalAgent sets conversationName to originalName (preserves original name in chat)
 *
 * The displayName defaults to "{User}'s Agent" from provisionPersonalAgent.
 */
export async function createMigratedPersonalAgent(
	ctx: TenantContext,
	params: {
		userId: string;
		userName: string;
		serverId: string;
		originalName: string;
		newAgentId: string;
	},
): Promise<PersonalAgentRow> {
	// 1. Create the personal_agents + user_agents rows (starts as 'pending')
	const row = await provisionPersonalAgent(ctx, {
		userId: params.userId,
		userName: params.userName,
		serverId: params.serverId,
	});

	// 2. Immediately transition to 'active' since the workspace already exists
	await updateProvisioningStatus(ctx, params.userId, 'active');

	// 3. Preserve the original agent name as conversationName
	// (displayName stays as "{User}'s Agent" per CONTEXT.md)
	await updatePersonalAgent(ctx, params.userId, {
		conversationName: params.originalName,
	});

	return {
		...row,
		provisioningStatus: 'active',
		conversationName: params.originalName,
	};
}
