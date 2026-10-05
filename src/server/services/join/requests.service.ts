import {
  admitPendingRequest,
  readOwnPendingRequests,
  readOwnPendingRequestForOrganization,
} from './pending.repository';
import { supabaseAdmin } from '$server/supabase';
import { createMembership } from './membership';
import { sendJoinRequestEmail } from '$server/services/email.service';
import { prepareJoinReviewRecipients, recheckJoinReviewRecipient } from './notification-audience';

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
  const { request, created } = await admitPendingRequest(who, organizationId, message);
  if (!created) return request;

  // TODO(handoff): Replace this bounded best-effort fan-out with the durable
  // effect/receipt contract in proposals/2026-10-03-notification-recon.md.
  // Request creation stays committed when preparation or delivery is unavailable.
  try {
    const recipients = await prepareJoinReviewRecipients(organizationId);
    for (const recipient of recipients) {
      try {
        if (!(await recheckJoinReviewRecipient(organizationId, recipient))) continue;
        const result = await sendJoinRequestEmail({ to: recipient.email });
        if (!result.accepted) {
          console.error('[join-request-notification]', {
            errorClass: result.errorClass,
          });
        }
      } catch {
        console.error('[join-request-notification]', {
          errorClass: 'recipient_recheck_failed',
        });
      }
    }
  } catch (caught) {
    const errorClass =
      typeof caught === 'object' &&
      caught !== null &&
      'code' in caught &&
      caught.code === 'candidate_limit_exceeded'
        ? 'candidate_limit_exceeded'
        : 'audience_preparation_failed';
    console.error('[join-request-notification]', { errorClass });
  }

  return request;
}

/** Own pending requests across organizations, with an explicit bounded-many state. */
export const getPendingRequestsForUser = readOwnPendingRequests;
export const getPendingRequestForOrganization = readOwnPendingRequestForOrganization;

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
  // Tenant-scope the read: an admin can only act on a request that belongs to
  // the org they're approving into (else cross-tenant approve-by-id IDOR).
  const { data: row, error: readErr } = await sb
    .from('join_request')
    .select('*')
    .eq('id', id)
    .eq('organization_id', opts.organizationId)
    .single();
  if (readErr || !row) throw new Error('request not found');
  if (row.status !== 'pending') return; // no-op for already-resolved requests

  await createMembership(
    {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      supabaseId: row.supabase_id,
    },
    opts.organizationId,
    opts.role,
  );

  const { error } = await sb
    .from('join_request')
    .update({
      status: 'approved',
      reviewed_by: opts.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function denyRequest(
  id: string,
  opts: { reviewerId: string; organizationId: string },
): Promise<void> {
  // Tenant-scope the update: an admin of one org cannot deny another org's
  // request by id (cross-tenant IDOR). No-match → no-op (0 rows), not an error.
  const { error } = await supabaseAdmin()
    .from('join_request')
    .update({
      status: 'denied',
      reviewed_by: opts.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', opts.organizationId);
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
