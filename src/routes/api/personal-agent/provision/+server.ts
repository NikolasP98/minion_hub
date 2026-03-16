import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import {
	getPendingProvisioningForUser,
	markActive,
	markError,
} from '$server/services/personal-agent-provisioner';

/**
 * GET /api/personal-agent/provision
 *
 * Returns provisioning status for the current user's personal agent.
 * The client checks this on page load to determine if it should call agents.create.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const ctx = await getTenantCtx(locals);
	if (!ctx) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const result = await getPendingProvisioningForUser(ctx, locals.user.id);
	if (!result) {
		return json({ needsProvisioning: false });
	}

	return json({
		needsProvisioning: true,
		payload: result.payload,
	});
};

/**
 * POST /api/personal-agent/provision
 *
 * Called by the client after a successful (or failed) agents.create gateway call.
 * Transitions the provisioning state machine.
 *
 * Body: { status: 'active' | 'error', error?: string }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const ctx = await getTenantCtx(locals);
	if (!ctx) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const body = await request.json();

	if (body.status !== 'active' && body.status !== 'error') {
		return json({ error: 'status must be "active" or "error"' }, { status: 400 });
	}

	if (body.status === 'active') {
		await markActive(ctx, locals.user.id);
	} else {
		await markError(ctx, locals.user.id, body.error ?? 'Unknown error');
	}

	return json({ ok: true });
};
