import type { PersonalAgentRow } from './personal-agent.service';
import {
  getPersonalAgent,
  provisionPersonalAgent,
  updateProvisioningStatus,
} from './personal-agent.service';
import { gatewayCallToInstance } from '$lib/server/gateway-rpc';
import {
  preparePersonalAgentBinding,
  commitPersonalAgentBinding,
  recordPersonalAgentBindingFailure,
  recordPersonalAgentClientFailure,
  PersonalAgentBindingError,
} from './personal-agent-binding';
import type { CoreCtx } from '$server/auth/core-ctx';
import { orgAllows } from './entitlements.service';

const MAX_RETRIES = 5;
// Backoff: 5s, 30s, 2min, 10min, 10min
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 600_000];

export function getBackoffDelay(retryCount: number): number {
  return BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
}

export function shouldRetryAgent(agent: PersonalAgentRow, nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  if (agent.provisioningStatus === 'active' && agent.serverId) return false;
  if (agent.provisioningStatus === 'provisioning') return false;
  if (agent.retryCount >= MAX_RETRIES) return false;
  if (!['pending', 'error', 'active'].includes(agent.provisioningStatus)) return false;
  // Respect backoff delay
  if (agent.lastRetryAt) {
    const nextRetryAt = agent.lastRetryAt + getBackoffDelay(agent.retryCount);
    if (now < nextRetryAt) return false;
  }
  return true;
}

/**
 * Build the params for a gateway `agents.create` WebSocket call.
 * The gateway schema requires { name, workspace } and derives agentId from name
 * via normalizeAgentId(). We use the agentId (e.g. "personal-abc123") as the name
 * so the gateway produces the correct deterministic ID.
 * Workspace uses ~ prefix which resolveUserPath expands on the gateway server.
 */
export function getProvisioningPayload(agent: PersonalAgentRow): {
  name: string;
  workspace: string;
} {
  return {
    name: agent.agentId,
    workspace: `~/.minion/agents/${agent.agentId}/workspace`,
  };
}

/**
 * Check if the current user has a personal agent that needs provisioning.
 * Returns the agent row if it needs a gateway call, null otherwise.
 * Called from the provision API endpoint to signal the client to
 * trigger provisioning via sendRequest('agents.create').
 */
export async function getPendingProvisioningForUser(
  ctx: CoreCtx,
  userId: string,
): Promise<{ agent: PersonalAgentRow; payload: ReturnType<typeof getProvisioningPayload> } | null> {
  // Spec 043: an org without `ai` never gets a pending flag, so the browser sends no agents.create.
  if (!(await orgAllows(ctx.tenantId, 'ai', 'personal-agent.pending'))) return null;
  const agent = await getPersonalAgent(ctx, userId);
  if (!agent) return null;
  if (!shouldRetryAgent(agent)) return null;
  return { agent, payload: getProvisioningPayload(agent) };
}

/**
 * Mark an agent as provisioning (called server-side before client makes the gateway call).
 */
export async function markProvisioning(ctx: CoreCtx, userId: string): Promise<void> {
  await updateProvisioningStatus(ctx, userId, 'provisioning');
}

/**
 * Mark an agent as active (called from client-side API after successful agents.create).
 */
export async function markActive(ctx: CoreCtx, userId: string): Promise<void> {
  await activatePersonalAgent(ctx, userId, { verifyOnly: true });
}

/**
 * Mark an agent as error (called from client-side API after failed agents.create).
 */
export async function markError(ctx: CoreCtx, userId: string, _error: string): Promise<void> {
  await recordPersonalAgentClientFailure(ctx, userId);
}

export interface PersonalAgentIdentity {
  name?: string;
  personality?: string;
  personalityText?: string;
}

/** Shared by automatic ensure, explicit creation and legacy completion callbacks. */
export async function activatePersonalAgent(
  ctx: CoreCtx,
  userId: string,
  options: { verifyOnly?: boolean; identity?: PersonalAgentIdentity } = {},
): Promise<string> {
  const binding = await preparePersonalAgentBinding(ctx, userId);
  const { target, agent } = binding;
  const call = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
    gatewayCallToInstance<T>(target.url, target.token, method, params);
  const create = async () => {
    try {
      await call('agents.create', {
        name: agent.agent_id,
        workspace: `~/.minion/agents/${agent.agent_id}/workspace`,
      });
    } catch (err) {
      // An already-exists response is not evidence: the exact roster check below is mandatory.
      if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
    }
  };
  const rosterCount = async () => {
    const roster = await call<{ agents?: Array<{ id?: unknown }> }>('agents.list');
    return Array.isArray(roster?.agents)
      ? roster.agents.filter((a) => a.id === agent.agent_id).length
      : -1;
  };
  try {
    if (agent.provisioning_status !== 'active' && !options.verifyOnly) {
      if (!['pending', 'error'].includes(agent.provisioning_status)) {
        throw new PersonalAgentBindingError('Personal agent provisioning is already in progress.');
      }
      await create();
    }
    let count = await rosterCount();
    // An active row whose binding was never committed may never have reached this
    // gateway (prod 2026-10: 9/10 FACES agents); create it once, then re-verify.
    if (
      count === 0 &&
      agent.provisioning_status === 'active' &&
      !agent.gateway_id &&
      !options.verifyOnly
    ) {
      await create();
      count = await rosterCount();
    }
    if (count !== 1) {
      throw new PersonalAgentBindingError(
        'The personal agent was not found on its organization gateway.',
      );
    }
    if (options.identity) {
      const identity = options.identity;
      const name = identity.name?.trim() || agent.agent_id;
      const preset = identity.personality?.trim() || '';
      const snapshot = await call<{ hash?: string }>('config.get');
      await call('config.patch', {
        raw: JSON.stringify({
          agents: {
            list: [
              {
                id: agent.agent_id,
                name,
                identity: { name },
                personality: {
                  preset,
                  configured: preset.length > 0,
                  conversationName: name,
                  text: identity.personalityText ?? '',
                },
                contextMode: 'personal',
              },
            ],
          },
        }),
        baseHash: snapshot?.hash,
        note: 'Configure personal agent',
      });
    }
    await commitPersonalAgentBinding(ctx, binding);
    return agent.agent_id;
  } catch (err) {
    await recordPersonalAgentBindingFailure(ctx, binding);
    // Do not return gateway/config error bodies or credentials to the browser.
    if (err instanceof PersonalAgentBindingError) throw err;
    throw new Error('Personal agent gateway verification failed. Retry provisioning.');
  }
}

/** Ensure the existing identity is active and has a verified, immutable gateway binding. */
export async function ensureActivePersonalAgent(
  ctx: CoreCtx,
  params: { userId: string; email: string },
): Promise<boolean> {
  if (!ctx.profileId || ctx.profileId !== params.userId) return false;
  // Spec 043: no provisioning for an org without `ai` (existing agents stay, R21).
  if (!(await orgAllows(ctx.tenantId, 'ai', 'personal-agent.ensure'))) return false;
  try {
    let agent = await getPersonalAgent(ctx, params.userId);
    if (!agent) {
      // Persist no authority until the exact runtime agent has been verified.
      agent = await provisionPersonalAgent(ctx, { ...params, serverId: '' });
    }
    if (agent.provisioningStatus === 'active' && agent.serverId) {
      await preparePersonalAgentBinding(ctx, params.userId);
      return true;
    }
    if (!shouldRetryAgent(agent)) return false;
    await activatePersonalAgent(ctx, params.userId);
    return true;
  } catch {
    console.warn('[personal-agent] Gateway assignment verification failed; no assignment changed.');
    return false;
  }
}
