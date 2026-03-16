import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import {
	getPersonalAgent,
	updatePersonalAgent,
	type PersonalityPreset,
} from '$server/services/personal-agent.service';

const VALID_PRESETS: PersonalityPreset[] = ['professional', 'casual', 'creative', 'technical'];

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
 * Updates the authenticated user's personal agent.
 * Accepts partial updates: displayName, conversationName, personalityPreset,
 * personalityText, personalityConfigured, avatarUrl.
 *
 * Gateway push is NOT done server-side -- the client calls sendRequest()
 * via the browser WebSocket after a successful PATCH.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const ctx = await getTenantCtx(locals);
	if (!ctx) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const body = await request.json();

	// ── Validation ──────────────────────────────────────────────────────────

	if (body.displayName !== undefined) {
		if (typeof body.displayName !== 'string' || body.displayName.length < 1 || body.displayName.length > 50) {
			return json({ error: 'displayName must be 1-50 characters' }, { status: 400 });
		}
	}

	if (body.personalityText !== undefined && body.personalityText !== null) {
		if (typeof body.personalityText !== 'string' || body.personalityText.length > 500) {
			return json({ error: 'personalityText must be at most 500 characters' }, { status: 400 });
		}
	}

	if (body.personalityPreset !== undefined && body.personalityPreset !== null) {
		if (!VALID_PRESETS.includes(body.personalityPreset)) {
			return json({ error: 'personalityPreset must be one of: professional, casual, creative, technical' }, { status: 400 });
		}
	}

	// ── Build update object (only include provided fields) ──────────────────

	const updates: Record<string, unknown> = {};
	if (body.displayName !== undefined) updates.displayName = body.displayName;
	if (body.conversationName !== undefined) updates.conversationName = body.conversationName;
	if (body.personalityPreset !== undefined) updates.personalityPreset = body.personalityPreset;
	if (body.personalityText !== undefined) updates.personalityText = body.personalityText;
	if (body.personalityConfigured !== undefined) updates.personalityConfigured = body.personalityConfigured;
	if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

	await updatePersonalAgent(ctx, locals.user.id, updates);

	return json({ ok: true });
};
