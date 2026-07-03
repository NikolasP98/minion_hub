import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listBookings } from '$server/services/scheduling-bookings.service';

/**
 * GET /api/gateway/query/bookings?agentId=personal-<uuid>[&orgId=][&from=][&to=][&status=][&contact=]
 *
 * Upcoming/past bookings, filterable by contact/date/status.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx, capabilities } = await requireAssistantCapability(locals, url, 'scheduling', 'view');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const status = url.searchParams.get('status');
	const contact = url.searchParams.get('contact');

	const bookings = await listBookings(ctx, {
		from: from ? new Date(from) : undefined,
		to: to ? new Date(to) : undefined,
		status: status ? status.split(',') : undefined,
		crmContactId: contact ?? undefined,
		maskAttendeePii: capabilities.fieldLevel('scheduling') < SENSITIVE_FIELD_LEVEL,
	});
	return json({ bookings });
};
