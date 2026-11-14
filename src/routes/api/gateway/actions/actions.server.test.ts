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
        eq: () => ({
          maybeSingle: async () => ({ data: { display_name: 'Jane', email: 'jane@example.com' } }),
        }),
      }),
    }),
  }),
}));

const mockCreateBooking = vi.fn();
const mockPreviewAssistantBooking = vi.fn();
const mockGetBooking = vi.fn();
const mockSetBookingStatus = vi.fn();
const mockRealizeAccruals = vi.fn();
const { FakeBookingTransitionError } = vi.hoisted(() => ({
  FakeBookingTransitionError: class extends Error {
    readonly code = 'invalid_transition';
  },
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  previewAssistantBooking: (...args: unknown[]) => mockPreviewAssistantBooking(...args),
  getBooking: (...args: unknown[]) => mockGetBooking(...args),
  setBookingStatus: (...args: unknown[]) => mockSetBookingStatus(...args),
  SlotUnavailableError: class SlotUnavailableError extends Error {},
  BookingTransitionError: FakeBookingTransitionError,
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  listAccruals: vi.fn(),
  realizeAccruals: (...args: unknown[]) => mockRealizeAccruals(...args),
}));

const mockUpdateIssue = vi.fn();
vi.mock('$server/services/support.service', () => ({
  updateIssue: (...args: unknown[]) => mockUpdateIssue(...args),
  createIssue: vi.fn(),
  PRIORITIES: ['urgent', 'high', 'medium', 'low'],
}));
const mockSetOrderStatus = vi.fn();
vi.mock('$server/services/sales.service', () => ({
  setOrderStatus: (...args: unknown[]) => mockSetOrderStatus(...args),
  ORDER_STATUSES: ['draft', 'confirmed', 'invoiced', 'cancelled'],
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
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: async () => ({
    currency: 'PEN',
    timezone: 'America/Lima',
    fxBase: 'USD',
    fxQuote: 'PEN',
    fxRate: 3.75,
  }),
}));

const mockCreateNote = vi.fn();
vi.mock('$server/services/notes.service', () => ({
  createNote: (...args: unknown[]) => mockCreateNote(...args),
}));

const mockCreateBuiltTool = vi.fn();
const mockGetBuiltTool = vi.fn();
const mockUpdateBuiltTool = vi.fn();
const mockPublishBuiltTool = vi.fn();
vi.mock('$server/services/builder.service', () => ({
  createBuiltTool: (...args: unknown[]) => mockCreateBuiltTool(...args),
  getBuiltTool: (...args: unknown[]) => mockGetBuiltTool(...args),
  updateBuiltTool: (...args: unknown[]) => mockUpdateBuiltTool(...args),
  publishBuiltTool: (...args: unknown[]) => mockPublishBuiltTool(...args),
}));

import { POST as bookingCreatePOST } from './booking-create/+server';
import { POST as bookingCompletePOST } from './booking-complete/+server';
import { POST as ticketUpdatePOST } from './ticket-update/+server';
import { POST as orderUpdateStatusPOST } from './order-update-status/+server';
import { POST as stockEntryCreatePOST } from './stock-entry-create/+server';
import { POST as stockIssueFromInvoicePOST } from './stock-issue-from-invoice/+server';
import { POST as noteCreatePOST } from './note-create/+server';
import { POST as toolSavePOST } from './tool-save/+server';

/** Minimal Capabilities stub — only `can` is exercised by requireAssistantCapability. */
function makeCaps(allowed: Record<string, boolean> = {}): Capabilities {
  return {
    roles: ['staff'],
    can: (module, action) => allowed[`${module}.${action}`] ?? false,
    canRunAnalytics: () => false,
    visibleModules: () => [],
    ownerScoped: () => false,
    fieldLevel: () => 0,
    explicitView: () => undefined,
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
    mockPreviewAssistantBooking.mockResolvedValue({
      eventTypeId: 'et1',
      serviceTitle: 'Consultation',
      resourceId: 'r1',
      resourceName: 'Clinician',
      start: '2026-08-01T10:00:00.000Z',
      end: '2026-08-01T11:00:00.000Z',
      attendeeName: 'Jane',
      attendeeEmail: null,
      attendeePhone: null,
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
    expect(mockPreviewAssistantBooking).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: 'org1' }),
      expect.objectContaining({
        eventTypeId: 'et1',
        start: new Date('2026-08-01T10:00:00.000Z'),
        strictContactReference: true,
      }),
    );
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });
});

describe('POST /api/gateway/actions/booking-complete', () => {
  const booking = { id: 'b1', title: 'Botox', status: 'no_show', productId: null, partyId: null };
  beforeEach(() =>
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'scheduling.edit': true }),
    }),
  );

  it('a closed booking answers 409 invalid_transition and realizes no stock', async () => {
    mockGetBooking.mockResolvedValue(booking);
    mockSetBookingStatus.mockRejectedValue(
      new FakeBookingTransitionError('booking is no_show; it cannot become completed'),
    );
    const res = await bookingCompletePOST(
      makeEvent('/api/gateway/actions/booking-complete', { confirm: true, bookingId: 'b1' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'invalid_transition',
      message: 'booking is no_show; it cannot become completed',
    });
    expect(mockRealizeAccruals).not.toHaveBeenCalled();
  });

  it('an already-completed booking stays idempotent: no status write, the realize retries', async () => {
    mockGetBooking.mockResolvedValue({ ...booking, status: 'completed' });
    mockRealizeAccruals.mockResolvedValue({ entry: null, realized: 0, stockWarning: null });
    const res = await bookingCompletePOST(
      makeEvent('/api/gateway/actions/booking-complete', { confirm: true, bookingId: 'b1' }),
    );
    expect(res.status).toBe(200);
    expect(mockSetBookingStatus).not.toHaveBeenCalled();
    expect(mockRealizeAccruals).toHaveBeenCalledTimes(1);
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
        makeEvent('/api/gateway/actions/ticket-update', {
          confirm: false,
          issueId: 'tk1',
          status: 'resolved',
        }),
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
      makeEvent('/api/gateway/actions/ticket-update', {
        confirm: false,
        issueId: 'tk1',
        status: 'resolved',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: { action: string; issueId: string; status: string };
    };
    expect(body.preview.action).toBe('ticket-update');
    expect(body.preview.status).toBe('resolved');
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});

/** The assistant's workflow actor: the member's identity with no role (open transitions only). */
const noRoleActor = { id: 'u1', name: 'Jane (via agent)', email: 'jane@example.com', role: null };

describe('POST /api/gateway/actions/order-update-status', () => {
  it('confirm:true passes a no-role workflow actor to setOrderStatus', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'sales.edit': true }),
    });
    mockSetOrderStatus.mockResolvedValue({ id: 'so1', status: 'confirmed' });
    const res = await orderUpdateStatusPOST(
      makeEvent('/api/gateway/actions/order-update-status', {
        confirm: true,
        orderId: 'so1',
        status: 'confirmed',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSetOrderStatus).toHaveBeenCalledTimes(1);
    expect(mockSetOrderStatus.mock.calls[0][5]).toEqual(noRoleActor);
  });

  it('a workflow refusal (409) propagates', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'sales.edit': true }),
    });
    mockSetOrderStatus.mockRejectedValue({ status: 409, body: { message: 'transition' } });
    await expect(
      orderUpdateStatusPOST(
        makeEvent('/api/gateway/actions/order-update-status', {
          confirm: true,
          orderId: 'so1',
          status: 'draft',
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('POST /api/gateway/actions/ticket-update (workflow)', () => {
  it('confirm:true passes a no-role workflow actor to updateIssue', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'support.edit': true }),
    });
    mockUpdateIssue.mockResolvedValue({ id: 'tk1', status: 'resolved' });
    const res = await ticketUpdatePOST(
      makeEvent('/api/gateway/actions/ticket-update', {
        confirm: true,
        issueId: 'tk1',
        status: 'resolved',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdateIssue.mock.calls[0][5]).toEqual(noRoleActor);
  });

  it('a workflow refusal (409) propagates', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'support.edit': true }),
    });
    mockUpdateIssue.mockRejectedValue({ status: 409, body: { message: 'transition' } });
    await expect(
      ticketUpdatePOST(
        makeEvent('/api/gateway/actions/ticket-update', {
          confirm: true,
          issueId: 'tk1',
          status: 'closed',
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
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
    const body = (await res.json()) as {
      preview: { action: string; type: string; lines: unknown[] };
    };
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
      lines: [
        {
          itemId: 'item1',
          itemName: 'Toxina',
          itemCode: 'TOX',
          uom: 'unit',
          qty: 30,
          available: 100,
        },
      ],
      unmatched: [],
    });
    const res = await stockIssueFromInvoicePOST(
      makeEvent('/api/gateway/actions/stock-issue-from-invoice', {
        confirm: false,
        invoiceId: 'inv1',
        warehouseId: 'wh1',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: { action: string; invoiceId: string; lines: unknown[] };
    };
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
    mockCreateIssueFromInvoice.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'duplicate_invoice' }),
    );
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

describe('POST /api/gateway/actions/note-create', () => {
  // No RBAC module gates notes (principal-scoped personal data) — only
  // resolveAssistantPrincipal identity resolution applies, so there's no 403
  // case here (unlike the RBAC-gated actions above).

  it('creates a plain note with the exact NoteData shape (body/attachments)', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({ principalId: 'u1', orgId: 'org1' });
    mockCreateNote.mockResolvedValue({ id: 'note1' });
    const res = await noteCreatePOST(
      makeEvent('/api/gateway/actions/note-create', {
        confirm: true,
        kind: 'note',
        title: 'Grocery list',
        content: 'Buy milk',
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; noteId: string };
    expect(body.ok).toBe(true);
    expect(body.noteId).toBe('note1');
    expect(mockCreateNote).toHaveBeenCalledTimes(1);
    const [ctx, input] = mockCreateNote.mock.calls[0] as [
      { tenantId: string; userId: string },
      { kind: string; data: { body: string; attachments: unknown[] } },
    ];
    expect(ctx).toMatchObject({ tenantId: 'org1', userId: 'u1' });
    expect(input.kind).toBe('note');
    expect(input.data).toEqual({ body: 'Buy milk', attachments: [] });
  });

  it('creates a todo note with per-item ids so the checklist survives parseNoteData', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({ principalId: 'u1', orgId: 'org1' });
    mockCreateNote.mockResolvedValue({ id: 'todo1' });
    await noteCreatePOST(
      makeEvent('/api/gateway/actions/note-create', {
        confirm: true,
        kind: 'todo',
        title: 'Errands',
        todos: [{ text: 'Buy milk' }, { text: 'Walk dog', done: true }],
      }),
    );
    const [, input] = mockCreateNote.mock.calls[0] as [
      unknown,
      { data: { items: Array<{ id: string; text: string; done: boolean }> } },
    ];
    expect(input.data.items).toHaveLength(2);
    for (const item of input.data.items) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
    }
    expect(input.data.items[0]).toMatchObject({ text: 'Buy milk', done: false });
    expect(input.data.items[1]).toMatchObject({ text: 'Walk dog', done: true });
  });

  it('creates an easel note with an empty canvas', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({ principalId: 'u1', orgId: 'org1' });
    mockCreateNote.mockResolvedValue({ id: 'easel1' });
    await noteCreatePOST(
      makeEvent('/api/gateway/actions/note-create', {
        confirm: true,
        kind: 'easel',
        title: 'Board',
      }),
    );
    const [, input] = mockCreateNote.mock.calls[0] as [unknown, { data: { items: unknown[] } }];
    expect(input.data).toEqual({ items: [] });
  });
});

describe('POST /api/gateway/actions/tool-save', () => {
  it('403s when the principal lacks tools:manage (RBAC denial)', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps(),
    });
    await expect(
      toolSavePOST(
        makeEvent('/api/gateway/actions/tool-save', {
          confirm: true,
          name: 'My Tool',
          scriptLang: 'javascript',
          scriptCode: 'console.log(1)',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockCreateBuiltTool).not.toHaveBeenCalled();
  });

  it('missing confirm:true 400s and performs no write', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'tools.manage': true }),
    });
    await expect(
      toolSavePOST(
        makeEvent('/api/gateway/actions/tool-save', {
          confirm: false,
          name: 'My Tool',
          scriptLang: 'javascript',
          scriptCode: 'console.log(1)',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockCreateBuiltTool).not.toHaveBeenCalled();
  });

  it('id absent creates a new draft tool', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'tools.manage': true }),
    });
    mockCreateBuiltTool.mockResolvedValue({ id: 'tool1' });
    const res = await toolSavePOST(
      makeEvent('/api/gateway/actions/tool-save', {
        confirm: true,
        name: 'My Tool',
        scriptLang: 'javascript',
        scriptCode: 'console.log(1)',
        permission: { module: 'projects', action: 'view' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; toolId: string; status: string };
    expect(body).toEqual({ ok: true, toolId: 'tool1', status: 'draft' });
    expect(mockCreateBuiltTool).toHaveBeenCalledTimes(1);
    const [, input] = mockCreateBuiltTool.mock.calls[0] as [unknown, { executionConfig?: string }];
    expect(JSON.parse(input.executionConfig!)).toEqual({
      permission: { module: 'projects', action: 'view' },
    });
    expect(mockUpdateBuiltTool).not.toHaveBeenCalled();
    expect(mockPublishBuiltTool).not.toHaveBeenCalled();
  });

  it('id present updates the existing tool, merges permission into executionConfig, and publishes', async () => {
    mockResolveAssistantPrincipal.mockResolvedValue({
      principalId: 'u1',
      orgId: 'org1',
      capabilities: makeCaps({ 'tools.manage': true }),
    });
    mockGetBuiltTool.mockResolvedValue({
      id: 'tool1',
      executionConfig: JSON.stringify({ other: 'keep-me' }),
    });
    mockUpdateBuiltTool.mockResolvedValue(undefined);
    mockPublishBuiltTool.mockResolvedValue(undefined);
    const res = await toolSavePOST(
      makeEvent('/api/gateway/actions/tool-save', {
        confirm: true,
        id: 'tool1',
        name: 'My Tool v2',
        scriptLang: 'javascript',
        scriptCode: 'console.log(2)',
        permission: { module: 'projects', action: 'view' },
        publish: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; toolId: string; status: string };
    expect(body).toEqual({ ok: true, toolId: 'tool1', status: 'published' });
    expect(mockCreateBuiltTool).not.toHaveBeenCalled();
    expect(mockUpdateBuiltTool).toHaveBeenCalledTimes(1);
    const [, toolId, input] = mockUpdateBuiltTool.mock.calls[0] as [
      unknown,
      string,
      { executionConfig?: string },
    ];
    expect(toolId).toBe('tool1');
    expect(JSON.parse(input.executionConfig!)).toEqual({
      other: 'keep-me',
      permission: { module: 'projects', action: 'view' },
    });
    expect(mockPublishBuiltTool).toHaveBeenCalledTimes(1);
  });
});
