import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import {
  getPersonalAgent,
  updatePersonalAgent,
} from '$server/services/personal-agent.service';

/**
 * GET /api/personal-agent
 *
 * Returns the authenticated user's personal agent row (or null).
 */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const ctx = await getTenantCtx(locals);
  if (!ctx) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const agent = await getPersonalAgent(ctx, locals.user.id);
  return json({ agent });
};

/**
 * PATCH /api/personal-agent
 *
 * Updates the authenticated user's personal agent. Currently only
 * `avatarUrl` is accepted — every other identity/personality field has
 * moved to the gateway config (`agents.list[].identity.*` and
 * `agents.list[].personality.*`) and is written via `config.patch`.
 *
 * Older clients that send `displayName`, `conversationName`,
 * `personalityPreset`, `personalityText`, or `personalityConfigured` will
 * have those fields silently ignored (logged). This mirrors the Phase 2b
 * displayName migration pattern.
 */
const DEPRECATED_FIELDS = [
  'displayName',
  'conversationName',
  'personalityPreset',
  'personalityText',
  'personalityConfigured',
] as const;

export const PATCH: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const ctx = await getTenantCtx(locals);
  if (!ctx) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();

  // ── Validation: warn on deprecated fields ───────────────────────────────

  for (const field of DEPRECATED_FIELDS) {
    if (body[field] !== undefined) {
      console.warn(
        `[api/personal-agent] PATCH received ${field} — ignoring. ` +
          'Identity + personality state now lives in gateway config ' +
          '(agents.list[].identity.* and agents.list[].personality.*).',
      );
    }
  }

  // ── Build update object (only include provided fields) ──────────────────

  const updates: Record<string, unknown> = {};
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

  await updatePersonalAgent(ctx, locals.user.id, updates);

  return json({ ok: true });
};
