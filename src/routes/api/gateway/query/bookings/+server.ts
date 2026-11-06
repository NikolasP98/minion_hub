import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { SENSITIVE_FIELD_LEVEL } from '$lib/permissions';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { queryAssistantBookings } from '$server/services/scheduling-bookings.service';

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

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 500 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw error(400, 'limit: expected integer 1..500');
  const mode = url.searchParams.get('mode') ?? 'list';
  if (!['list', 'count'].includes(mode)) throw error(400, 'mode: expected list or count');
  for (const [field, value] of [
    ['from', from],
    ['to', to],
  ]) {
    if (value !== null && (!value || !Number.isFinite(Date.parse(value))))
      throw error(400, `${field}: invalid date`);
  }
  if (from && to && Date.parse(from) > Date.parse(to))
    throw error(400, 'to: must be at or after from');
  const result = await queryAssistantBookings(ctx, {
    limit,
    countOnly: mode === 'count',
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    status: status ? status.split(',') : undefined,
    crmContactId: contact ?? undefined,
    maskAttendeePii: capabilities.fieldLevel('scheduling') < SENSITIVE_FIELD_LEVEL,
  });
  return json(result);
};
