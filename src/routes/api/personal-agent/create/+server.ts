import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { gatewayCall } from '$lib/server/gateway-rpc';
import {
  getPendingProvisioningForUser,
  markActive,
  markError,
} from '$server/services/personal-agent-provisioner';

/**
 * POST /api/personal-agent/create
 *
 * Provisions the current user's *own* pending personal agent on the gateway.
 *
 * Why server-side: `agents.create` and `config.patch` require the
 * `operator.admin` gateway scope. Member users connect with a JWT that only
 * carries `operator.read`/`operator.write` (see `mapRoleToScopes`), so the old
 * browser-side `sendRequest('agents.create')` path failed for them with
 * "missing scope: operator.admin". Here the hub performs the privileged calls
 * with the system gateway credentials (admin), but only for the agent the
 * provisioner has flagged as pending for THIS user — a member can never create
 * an arbitrary agent, only their own personal one.
 *
 * Body: { name: string; personality: string; personalityText?: string }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const ctx = await getCoreCtx(locals);
  if (!ctx) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    personality?: string;
    personalityText?: string;
  };
  const displayName = (body.name ?? '').trim();
  const personality = (body.personality ?? '').trim();
  if (!displayName) {
    return json({ error: 'name is required' }, { status: 400 });
  }

  // Canonical provisioning payload (agentId + workspace) comes from the server,
  // never the client — this is the gate that limits a user to their own agent.
  const pending = await getPendingProvisioningForUser(ctx, locals.user.id);
  if (!pending) {
    return json(
      { error: 'No pending personal agent was found for this user.' },
      { status: 409 },
    );
  }

  const agentId = pending.agent.agentId;

  try {
    // 1. Create the agent (idempotent — tolerate a prior partial attempt).
    try {
      await gatewayCall('agents.create', pending.payload);
    } catch (err) {
      if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
    }

    // 2. Enrich it with the onboarding identity/personality via config.patch
    //    (optimistic concurrency on the current config hash).
    const cfgSnapshot = (await gatewayCall('config.get', {})) as { hash?: string } | null;
    await gatewayCall('config.patch', {
      raw: JSON.stringify({
        agents: {
          list: [
            {
              id: agentId,
              name: displayName,
              identity: { name: displayName },
              personality: {
                preset: personality,
                configured: true,
                conversationName: displayName,
                text: body.personalityText ?? '',
              },
              contextMode: 'personal',
            },
          ],
        },
      }),
      baseHash: cfgSnapshot?.hash,
      note: `Create personal agent ${agentId} from onboarding`,
    });

    // 3. Advance the provisioning state machine.
    await markActive(ctx, locals.user.id);
    return json({ ok: true, agentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markError(ctx, locals.user.id, message);
    return json({ error: message }, { status: 502 });
  }
};
