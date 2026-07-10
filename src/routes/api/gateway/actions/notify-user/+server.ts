import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { supabaseAdmin } from '$server/supabase';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';

const bodySchema = z.object({
	confirm: z.boolean(),
	recipientProfileId: z.string().min(1).max(200),
	subject: z.string().max(200).optional(),
	body: z.string().trim().min(1).max(2000),
});

/**
 * POST /api/gateway/actions/notify-user?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, recipientProfileId, subject?, body }
 *
 * SERVICE GAP: there is no "notify an org member now" service — notif.service.ts
 * is entirely rule/cron-driven (date-offset triggers on business rows), and
 * `profiles` has no phone column, so there's no internal messaging channel to
 * reuse. This sends a capped free-text EMAIL via the gateway's `channels.send`
 * RPC (already used by reminders.service.ts) directly from the route — no new
 * service code, but also unverified against the gateway's channel support for
 * an 'email' channel (that's the W2/gateway side; report if it 404s/rejects).
 * RBAC: comms OR memberships view, PLUS an explicit check that the recipient is
 * actually a member of the caller's org (no cross-org notify).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { principalId, orgId, capabilities } = await resolveAssistantPrincipal(locals, url);
	if (!capabilities.can('comms', 'view') && !capabilities.can('memberships', 'view')) {
		return json({ error: 'Your role does not permit notifying org members.' }, { status: 403 });
	}
	const b = await parseBody(request, bodySchema);

	const { data: member } = await supabaseAdmin()
		.from('organization_members')
		.select('profile_id')
		.eq('organization_id', orgId)
		.eq('profile_id', b.recipientProfileId)
		.maybeSingle();
	if (!member) throw error(404, 'recipient is not a member of this organization');

	if (!b.confirm) {
		return json({
			preview: { action: 'notify-user', recipientProfileId: b.recipientProfileId, subject: b.subject ?? null, body: b.body },
		});
	}

	const { data: recipient } = await supabaseAdmin()
		.from('profiles')
		.select('email, display_name')
		.eq('id', b.recipientProfileId)
		.maybeSingle();
	const profile = recipient as { email: string; display_name: string | null } | null;
	if (!profile?.email) throw error(404, 'recipient has no email on file');

	try {
		const res = await gatewayCallAsUser<{ messageId?: string; id?: string }>(
			'channels.send',
			{
				channel: 'email',
				to: profile.email,
				text: b.body,
				...(b.subject ? { subject: b.subject } : {}),
				idempotencyKey: `notify-${b.recipientProfileId}-${Date.now()}`,
			},
			principalId,
			// Route to the org's assigned gateway when one exists (tenancy §3.4).
			{ orgId },
		);
		return json({ ok: true, messageId: res?.messageId ?? res?.id ?? null });
	} catch (e) {
		console.error('[POST /api/gateway/actions/notify-user]', e);
		return json({ error: e instanceof Error ? e.message : 'send failed' }, { status: 502 });
	}
};
