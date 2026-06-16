import { supabaseAdmin } from '$server/supabase';
import { createMembership } from './membership';
import { sendJoinRequestEmail } from '$server/services/email.service';

export interface Requester {
	id: string;
	supabaseId: string;
	email: string;
	displayName: string | null;
}

export interface JoinRequestRow {
	id: string;
	user_id: string;
	supabase_id: string;
	email: string;
	display_name: string | null;
	message: string | null;
	status: 'pending' | 'approved' | 'denied';
	organization_id: string;
	requested_role: string;
	created_at: string;
}

export async function createRequest(
	who: Requester,
	organizationId: string,
	message?: string,
): Promise<{ id: string; status: string }> {
	const sb = supabaseAdmin();

	const { data: existing } = await sb
		.from('join_request')
		.select('id,status')
		.eq('user_id', who.id)
		.eq('status', 'pending')
		.maybeSingle();
	if (existing) return existing as { id: string; status: string };

	const { data, error } = await sb
		.from('join_request')
		.insert({
			supabase_id: who.supabaseId,
			user_id: who.id,
			email: who.email,
			display_name: who.displayName,
			message: message ?? null,
			status: 'pending',
			organization_id: organizationId,
			requested_role: 'user',
		})
		.select()
		.single();
	if (error) throw new Error(`createRequest failed: ${error.message}`);

	const { data: admins } = await sb
		.from('profiles')
		.select('email,role')
		.in('role', ['admin']);
	for (const a of admins ?? []) {
		if (a.email) {
			await sendJoinRequestEmail({
				to: a.email,
				requesterEmail: who.email,
				requesterName: who.displayName ?? who.email,
			});
		}
	}

	return data as { id: string; status: string };
}

/**
 * Returns the user's outstanding pending request (if any), keyed by the hub
 * user id (== profile uuid post bridge-flip). Used by the /join load to send a
 * user who has already requested access to the "waiting on approval" screen
 * instead of re-showing the request form.
 */
export async function getPendingRequestForUser(
	userId: string,
): Promise<{ id: string; status: string } | null> {
	const { data } = await supabaseAdmin()
		.from('join_request')
		.select('id,status')
		.eq('user_id', userId)
		.eq('status', 'pending')
		.maybeSingle();
	return (data as { id: string; status: string } | null) ?? null;
}

/** An org's pending join requests. MUST be org-scoped — every caller is an
 *  org-level admin, so an unscoped list leaks other orgs' requesters. */
export async function listPendingRequests(organizationId: string): Promise<JoinRequestRow[]> {
	const { data, error } = await supabaseAdmin()
		.from('join_request')
		.select('*')
		.eq('organization_id', organizationId)
		.eq('status', 'pending')
		.order('created_at', { ascending: true });
	if (error) throw new Error(error.message);
	return (data ?? []) as JoinRequestRow[];
}

export async function approveRequest(
	id: string,
	opts: { reviewerId: string; role: string; organizationId: string },
): Promise<void> {
	const sb = supabaseAdmin();
	const { data: row, error: readErr } = await sb.from('join_request').select('*').eq('id', id).single();
	if (readErr || !row) throw new Error('request not found');
	if (row.status !== 'pending') return; // no-op for already-resolved requests

	await createMembership(
		{ id: row.user_id, email: row.email, displayName: row.display_name, supabaseId: row.supabase_id },
		opts.organizationId,
		opts.role,
	);

	const { error } = await sb
		.from('join_request')
		.update({ status: 'approved', reviewed_by: opts.reviewerId, reviewed_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw new Error(error.message);
}

export async function denyRequest(id: string, reviewerId: string): Promise<void> {
	const { error } = await supabaseAdmin()
		.from('join_request')
		.update({ status: 'denied', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw new Error(error.message);
}

/** Count an org's pending join requests. Supabase `join_request` is the
 *  system-of-record — the legacy Turso `joinRequests` table is unused in prod
 *  (querying it 500'd the /api/join-requests/count badge). */
export async function countPendingRequests(organizationId: string): Promise<number> {
	const { count, error } = await supabaseAdmin()
		.from('join_request')
		.select('id', { count: 'exact', head: true })
		.eq('organization_id', organizationId)
		.eq('status', 'pending');
	if (error) throw new Error(`countPendingRequests failed: ${error.message}`);
	return count ?? 0;
}
