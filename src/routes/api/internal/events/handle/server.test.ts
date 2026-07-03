import { describe, it, expect, vi, beforeEach } from 'vitest';

const bustFinanceCache = vi.fn(async (..._a: unknown[]) => {});
const processOrgNotifications = vi.fn(async (..._a: unknown[]) => ({ sent: 0, failed: 0, skipped: 0 }));

vi.mock('$env/dynamic/private', () => ({ env: { HUB_API_TOKEN: 'sekret' } }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/services/finance.service', () => ({
	bustFinanceCache: (...a: unknown[]) => bustFinanceCache(...a),
}));
vi.mock('$server/services/notif.service', () => ({
	processOrgNotifications: (...a: unknown[]) => processOrgNotifications(...a),
}));

import { POST } from './+server';

function req(body: unknown, auth = 'Bearer sekret') {
	return {
		request: new Request('http://x/api/internal/events/handle', {
			method: 'POST',
			headers: { authorization: auth, 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/internal/events/handle', () => {
	it('rejects a bad bearer token', async () => {
		await expect(
			POST(req({ type: 'booking.created', orgId: 'org-1', bookingId: 'b1' }, 'Bearer wrong')),
		).rejects.toMatchObject({ status: 401 });
		expect(processOrgNotifications).not.toHaveBeenCalled();
	});

	it('ignores unknown event types (forward compat)', async () => {
		const res = await POST(req({ type: 'something.unknown', orgId: 'org-1' }));
		expect(await res.json()).toEqual({ ignored: true });
		expect(bustFinanceCache).not.toHaveBeenCalled();
		expect(processOrgNotifications).not.toHaveBeenCalled();
	});

	it('routes finance.invoices_upserted to bustFinanceCache', async () => {
		const res = await POST(
			req({ type: 'finance.invoices_upserted', orgId: 'org-1', created: 2, updated: 1 }),
		);
		expect(await res.json()).toEqual({ ok: true });
		expect(bustFinanceCache).toHaveBeenCalledTimes(1);
		expect(bustFinanceCache).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'org-1' }));
	});

	it('routes booking.created to the notification-rules engine', async () => {
		const res = await POST(req({ type: 'booking.created', orgId: 'org-1', bookingId: 'b1' }));
		expect(await res.json()).toEqual({ ok: true });
		expect(processOrgNotifications).toHaveBeenCalledTimes(1);
		expect(processOrgNotifications.mock.calls[0][0]).toMatchObject({ tenantId: 'org-1' });
	});

	it('routes ticket.status_changed to the notification-rules engine', async () => {
		const res = await POST(
			req({ type: 'ticket.status_changed', orgId: 'org-1', issueId: 'i1', old: 'open', new: 'resolved' }),
		);
		expect(await res.json()).toEqual({ ok: true });
		expect(processOrgNotifications).toHaveBeenCalledTimes(1);
	});
});
