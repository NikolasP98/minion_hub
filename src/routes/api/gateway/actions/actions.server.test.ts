import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Capabilities } from '$server/services/rbac.service';

const mockResolveAssistantPrincipal = vi.fn();
vi.mock('$server/auth/assistant-principal', () => ({
	resolveAssistantPrincipal: (...args: unknown[]) => mockResolveAssistantPrincipal(...args),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn(() => ({})) }));
vi.mock('$server/supabase', () => ({
	supabaseAdmin: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'Jane', email: 'jane@example.com' } }) }),
			}),
		}),
	}),
}));

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

const mockCreateEntry = vi.fn();
const mockBuildInvoiceIssuePreview = vi.fn();
const mockCreateIssueFromInvoice = vi.fn();
vi.mock('$server/services/stock.service', () => ({
	createEntry: (...args: unknown[]) => mockCreateEntry(...args),
	buildInvoiceIssuePreview: (...args: unknown[]) => mockBuildInvoiceIssuePreview(...args),
	createIssueFromInvoice: (...args: unknown[]) => mockCreateIssueFromInvoice(...args),
}));
vi.mock('$server/services/stock.logic', () => ({
	ENTRY_TYPES: ['receipt', 'issue', 'transfer', 'adjustment'],
}));

import { POST as bookingCreatePOST } from './booking-create/+server';
import { POST as ticketUpdatePOST } from './ticket-update/+server';
import { POST as stockEntryCreatePOST } from './stock-entry-create/+server';
import { POST as stockIssueFromInvoicePOST } from './stock-issue-from-invoice/+server';

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

describe('POST /api/gateway/actions/stock-entry-create', () => {
	it('403s when the principal lacks stock:create (RBAC denial)', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps(),
		});
		await expect(
			stockEntryCreatePOST(
				makeEvent('/api/gateway/actions/stock-entry-create', {
					confirm: false,
					type: 'receipt',
					lines: [{ itemId: 'item1', qty: 5, toWarehouseId: 'wh1' }],
				}),
			),
		).rejects.toMatchObject({ status: 403 });
		expect(mockCreateEntry).not.toHaveBeenCalled();
	});

	it('confirm:false returns a preview and performs no write', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'stock.create': true }),
		});
		const res = await stockEntryCreatePOST(
			makeEvent('/api/gateway/actions/stock-entry-create', {
				confirm: false,
				type: 'receipt',
				lines: [{ itemId: 'item1', qty: 5, toWarehouseId: 'wh1' }],
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { preview: { action: string; type: string; lines: unknown[] } };
		expect(body.preview.action).toBe('stock-entry-create');
		expect(body.preview.type).toBe('receipt');
		expect(body.preview.lines).toHaveLength(1);
		expect(mockCreateEntry).not.toHaveBeenCalled();
	});

	it('confirm:true creates a draft entry (never submitted) via createEntry', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'stock.create': true }),
		});
		mockCreateEntry.mockResolvedValue({ id: 'entry1', status: 'draft', type: 'receipt' });
		const res = await stockEntryCreatePOST(
			makeEvent('/api/gateway/actions/stock-entry-create', {
				confirm: true,
				type: 'receipt',
				lines: [{ itemId: 'item1', qty: 5, toWarehouseId: 'wh1', rate: 10 }],
			}),
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { entry: { status: string } };
		expect(body.entry.status).toBe('draft');
		expect(mockCreateEntry).toHaveBeenCalledTimes(1);
	});
});

describe('POST /api/gateway/actions/stock-issue-from-invoice', () => {
	it('403s when the principal lacks stock:create (RBAC denial)', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps(),
		});
		await expect(
			stockIssueFromInvoicePOST(
				makeEvent('/api/gateway/actions/stock-issue-from-invoice', {
					confirm: false,
					invoiceId: 'inv1',
					warehouseId: 'wh1',
				}),
			),
		).rejects.toMatchObject({ status: 403 });
		expect(mockBuildInvoiceIssuePreview).not.toHaveBeenCalled();
	});

	it('confirm:false returns the computed preview and performs no write', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'stock.create': true }),
		});
		mockBuildInvoiceIssuePreview.mockResolvedValue({
			lines: [{ itemId: 'item1', itemName: 'Toxina', itemCode: 'TOX', uom: 'unit', qty: 30, available: 100 }],
			unmatched: [],
		});
		const res = await stockIssueFromInvoicePOST(
			makeEvent('/api/gateway/actions/stock-issue-from-invoice', { confirm: false, invoiceId: 'inv1', warehouseId: 'wh1' }),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { preview: { action: string; invoiceId: string; lines: unknown[] } };
		expect(body.preview.action).toBe('stock-issue-from-invoice');
		expect(body.preview.invoiceId).toBe('inv1');
		expect(body.preview.lines).toHaveLength(1);
		expect(mockCreateIssueFromInvoice).not.toHaveBeenCalled();
	});

	it('confirm:true creates the issue entry via createIssueFromInvoice', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'stock.create': true }),
		});
		mockCreateIssueFromInvoice.mockResolvedValue({ id: 'entry1', status: 'draft', type: 'issue' });
		const res = await stockIssueFromInvoicePOST(
			makeEvent('/api/gateway/actions/stock-issue-from-invoice', {
				confirm: true,
				invoiceId: 'inv1',
				warehouseId: 'wh1',
				lines: [{ itemId: 'item1', qty: 30 }],
			}),
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { entry: { status: string } };
		expect(body.entry.status).toBe('draft');
		expect(mockCreateIssueFromInvoice).toHaveBeenCalledTimes(1);
		expect(mockBuildInvoiceIssuePreview).not.toHaveBeenCalled();
	});

	it('403s the duplicate-invoice guard error through (StockError bubbles unmapped)', async () => {
		mockResolveAssistantPrincipal.mockResolvedValue({
			principalId: 'u1',
			orgId: 'org1',
			capabilities: makeCaps({ 'stock.create': true }),
		});
		mockCreateIssueFromInvoice.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'duplicate_invoice' }));
		await expect(
			stockIssueFromInvoicePOST(
				makeEvent('/api/gateway/actions/stock-issue-from-invoice', {
					confirm: true,
					invoiceId: 'inv1',
					warehouseId: 'wh1',
					lines: [{ itemId: 'item1', qty: 30 }],
				}),
			),
		).rejects.toThrow('duplicate');
	});
});
