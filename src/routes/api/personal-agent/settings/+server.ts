import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { PersonalAgentBindingError } from '$server/services/personal-agent-binding';
import {
  sanitizePersonalAgentSettings,
  updatePersonalAgentSettings,
} from '$server/services/personal-agent-provisioner';

/**
 * POST /api/personal-agent/settings
 *
 * Saves the signed-in user's own agent name, conversation name and personality.
 * `config.patch` needs the gateway `operator.admin` scope, which a member's
 * per-user pass lacks (spec 045), so the hub patches with its own credential.
 * The agent is the caller's personal_agents row; the body only carries the
 * allowlisted fields (name, conversationName, preset, text) — an agentId in it
 * is ignored.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
  const ctx = await getCoreCtx(locals);
  if (!ctx) return json({ error: 'Authentication required' }, { status: 401 });

  const settings = sanitizePersonalAgentSettings(await request.json().catch(() => ({})));
  if (Object.keys(settings).length === 0) {
    return json({ error: 'No editable field in the request.' }, { status: 400 });
  }
  try {
    const agentId = await updatePersonalAgentSettings(ctx, locals.user.id, settings);
    return json({ ok: true, agentId });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Personal agent settings could not be saved.' },
      { status: err instanceof PersonalAgentBindingError ? 409 : 502 },
    );
  }
};
