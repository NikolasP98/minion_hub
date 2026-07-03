import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Capabilities } from '$server/services/rbac.service';

const mockResolveAssistantPrincipal = vi.fn();
vi.mock('$server/auth/assistant-principal', () => ({
	resolveAssistantPrincipal: (...args: unknown[]) => mockResolveAssistantPrincipal(...args),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn(() => ({})) }));

const mockCreateBooking = vi.fn();
vi.mock('$server/services/scheduling-bookings.service', () => ({
	createBooking: (...args: unknown[]) => mockCreateBooking(...args),
	setBookingStatus: vi.fn(),
	SlotUnavailableError: class SlotUnavailableError extends Error {},
}));

const mockUpdateIssue = vi.fn();
vi.mock('$server/services/support.service', () => ({
	updateIssue: (...args: unknown[]) => mockUpdateIssue(...args),
	createIssue: vi.fn(),
	PRIORITIES: ['urgent', 'high', 'medium', 'low'],
}));
vi.mock('$server/services/errors', () => ({
	StaleWriteError: class StaleWriteError extends Error {},
	staleGuard: vi.fn(),
}));

import { POST as bookingCreatePOST } from './booking-create/+server';
import { POST as ticketUpdatePOST } from './ticket-update/+server';

/** Minimal Capabilities stub — only `can` is exercised by requireAssistantCapability. */
function makeCaps(allowed: Record<string, boolean> = {}): Capabilities {
	return {
		roles: ['staff'],
		can: (module, action) => allowed[`${module}.${action}`] ?? false,
		canRunAnalytics: () => false,
		visibleModules: () => [],
		ownerScoped: () => false,
		fieldLevel: () => 0,
	};
}

function makeEvent(path: string, body: unknown) {
	return {
		locals: {},
		url: new URL(`http://localhost${path}?agentId=personal-u1`),
		request: { json: async () => body },
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/gateway/actions/booking-create', () => {
	it('403s when the principal lacks scheduling:create (RBAC denial)', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps(),
		});
		await expect(
			bookingCreatePOST(
				makeEvent('/api/gateway/actions/booking-create', {
					confirm: false,
					eventTypeId: 'et1',
					start: '2026-08-01T10:00:00.000Z',
				}),
			),
		).rejects.toMatchObject({ status: 403 });
		expect(mockCreateBooking).not.toHaveBeenCalled();
	});

	it('confirm:false returns a preview and performs no write', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'scheduling.create': true }),
		});
		const res = await bookingCreatePOST(
			makeEvent('/api/gateway/actions/booking-create', {
				confirm: false,
				eventTypeId: 'et1',
				start: '2026-08-01T10:00:00.000Z',
				attendeeName: 'Jane',
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { preview: { action: string; eventTypeId: string } };
		expect(body.preview.action).toBe('booking-create');
		expect(body.preview.eventTypeId).toBe('et1');
		expect(mockCreateBooking).not.toHaveBeenCalled();
	});
});

describe('POST /api/gateway/actions/ticket-update', () => {
	it('403s when the principal lacks support:edit (RBAC denial)', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps(),
		});
		await expect(
			ticketUpdatePOST(
				makeEvent('/api/gateway/actions/ticket-update', { confirm: false, issueId: 'tk1', status: 'resolved' }),
			),
		).rejects.toMatchObject({ status: 403 });
		expect(mockUpdateIssue).not.toHaveBeenCalled();
	});

	it('confirm:false returns a preview and performs no write', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'support.edit': true }),
		});
		const res = await ticketUpdatePOST(
			makeEvent('/api/gateway/actions/ticket-update', { confirm: false, issueId: 'tk1', status: 'resolved' }),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { preview: { action: string; issueId: string; status: string } };
		expect(body.preview.action).toBe('ticket-update');
		expect(body.preview.status).toBe('resolved');
		expect(mockUpdateIssue).not.toHaveBeenCalled();
	});
});
