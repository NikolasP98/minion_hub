import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listIssues } from '$server/services/support.service';

/**
 * GET /api/gateway/query/tickets?agentId=personal-<uuid>[&orgId=][&status=][&priority=][&contact=]
 *
 * Open (or filtered) tickets by status/priority/contact. `status=open_all`
 * covers open+replied+on_hold in one call (matches the human support dashboard's
 * default view).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx, capabilities, principalId } = await requireAssistantCapability(locals, url, 'support', 'view');
	const status = url.searchParams.get('status') as
		| 'open'
		| 'replied'
		| 'on_hold'
		| 'resolved'
		| 'closed'
		| 'open_all'
		| null;
	const priority = url.searchParams.get('priority') as 'low' | 'medium' | 'high' | 'urgent' | null;
	const contact = url.searchParams.get('contact');

	// Record-level (if-owner): scoped to the resolved principal's assigned tickets
	// when their role restricts support to owned records (matches ownerFilter's
	// intent for the browser session — but keyed to the trusted principal, since
	// ownerFilter(locals,...) has no locals.user for gateway callers).
	const ownerId = capabilities.ownerScoped('support') ? principalId : undefined;

	const issues = await listIssues(ctx, {
		status: status ?? 'open_all',
		priority: priority ?? undefined,
		crmContactId: contact ?? undefined,
		ownerId,
		limit: 200,
	});
	return json({ issues });
};
