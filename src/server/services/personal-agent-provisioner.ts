import type { PersonalAgentRow } from './personal-agent.service';
import {
  getPersonalAgent,
  provisionPersonalAgent,
  updateProvisioningStatus,
} from './personal-agent.service';
import { gatewayCall } from '$lib/server/gateway-rpc';
import type { CoreCtx } from '$server/auth/core-ctx';

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
  await updateProvisioningStatus(ctx, userId, 'active');
}

/**
 * Mark an agent as error (called from client-side API after failed agents.create).
 */
export async function markError(ctx: CoreCtx, userId: string, error: string): Promise<void> {
  await updateProvisioningStatus(ctx, userId, 'error', error);
}

/**
 * Guarantee the user has an ACTIVE personal agent, provisioning it server-side
 * if needed. Personal-agent provisioning is a mandatory part of user creation —
 * a signed-in user must never dead-end on a "not provisioned yet" screen, so
 * the (app) layout calls this instead of bouncing straight to /onboarding.
 *
 * Steps (all idempotent): ensure the personal_agents row + profiles pointer
 * exist (`provisionPersonalAgent`), then create the gateway agent with the
 * system credentials (same privileged path as /api/personal-agent/create and
 * brain-agents), then mark active. Identity/personality stay unconfigured —
 * the user can personalize later in settings; that's cosmetic, not blocking.
 *
 * Returns true when the agent is (now) active. Returns false — WITHOUT
 * throwing — when provisioning failed or is inside the retry backoff window,
 * so the caller can fall back to /onboarding's manual retry UI.
 */
export async function ensureActivePersonalAgent(
  ctx: CoreCtx,
  params: { userId: string; email: string },
): Promise<boolean> {
  let agent = await getPersonalAgent(ctx, params.userId);
  if (!agent) {
    try {
      agent = await provisionPersonalAgent(ctx, {
        userId: params.userId,
        email: params.email,
        serverId: '',
      });
    } catch (err) {
      console.error('[personal-agent] ensureActive: row provisioning failed', err);
      return false;
    }
  }
  if (agent.provisioningStatus === 'active') return true;
  if (!shouldRetryAgent(agent)) return false; // backoff/max-retries — don't hammer the gateway

  await markProvisioning(ctx, params.userId);
  try {
    try {
      await gatewayCall('agents.create', getProvisioningPayload(agent));
    } catch (err) {
      if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
    }
    await markActive(ctx, params.userId);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[personal-agent] ensureActive: gateway provisioning failed', message);
    await markError(ctx, params.userId, message);
    return false;
  }
}
