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
} from './personal-agent.service';
import type { TenantContext } from './base';

/**
 * Create hub DB entries for a migrated personal agent.
 *
 * Flow:
 * 1. provisionPersonalAgent creates personal_agents + user_agents rows (status 'pending')
 * 2. updateProvisioningStatus transitions to 'active' (workspace already exists from migration)
 *
 * Phase 3c — `conversationName` no longer lives in the hub DB; it now
 * lives in the gateway config at `agents.list[].personality.conversationName`.
 * The migration step that preserved `originalName` as `conversationName` in
 * the DB has been removed; the original name is preserved in the gateway
 * config by the gateway-side migration runner.
 */
export async function createMigratedPersonalAgent(
  ctx: TenantContext,
  params: {
    userId: string;
    email: string;
    serverId: string;
    originalName: string;
    newAgentId: string;
  },
): Promise<PersonalAgentRow> {
  // 1. Create the personal_agents + user_agents rows (starts as 'pending')
  const row = await provisionPersonalAgent(ctx, {
    userId: params.userId,
    email: params.email,
    serverId: params.serverId,
  });

  // 2. Immediately transition to 'active' since the workspace already exists
  await updateProvisioningStatus(ctx, params.userId, 'active');

  return {
    ...row,
    provisioningStatus: 'active',
  };
}
