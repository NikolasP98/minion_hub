import { supabaseAdmin } from '$server/supabase';
import { getDb } from '$server/db/client';
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
		.in('role', ['admin', 'super_admin']);
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

export async function listPendingRequests(): Promise<JoinRequestRow[]> {
	const { data, error } = await supabaseAdmin()
		.from('join_request')
		.select('*')
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
	// Atomically mark approved only if still pending; the returned row provides member data.
	const { data: row, error } = await sb
		.from('join_request')
		.update({ status: 'approved', reviewed_by: opts.reviewerId, reviewed_at: new Date().toISOString() })
		.eq('id', id)
		.select()
		.single();
	if (error) throw new Error(error.message);
	if (!row) return; // already non-pending — no-op

	await createMembership(
		getDb(),
		{ id: row.user_id, email: row.email, displayName: row.display_name },
		opts.organizationId,
		opts.role,
	);
}

export async function denyRequest(id: string, reviewerId: string): Promise<void> {
	const { error } = await supabaseAdmin()
		.from('join_request')
		.update({ status: 'denied', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw new Error(error.message);
}
