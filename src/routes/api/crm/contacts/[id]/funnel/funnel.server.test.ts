import { describe, it, expect, vi, beforeEach } from 'vitest';

// WP2 — the marketing funnel is business-CRM only; personal orgs 404 on this
// route (org-kind gate), same getTenant-by-tenantId pattern as /pulse.

const mockGetCoreCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: (locals: unknown) => mockGetCoreCtx(locals),
}));

const mockGetTenant = vi.fn<(ctx: unknown) => Promise<{ kind: string } | null>>();
vi.mock('$server/services/tenant.service', () => ({
  getTenant: (ctx: unknown) => mockGetTenant(ctx),
}));

const mockSetFunnelStage = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('$server/services/crm-contacts.service', () => ({
  setFunnelStage: (...a: unknown[]) => mockSetFunnelStage(...a),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/crm/contacts/c1/funnel', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/crm/contacts/[id]/funnel', () => {
  it('404s for a personal org', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockGetTenant.mockResolvedValue({ kind: 'personal' });

    const { PATCH } = await import('./+server');
    await expect(
      PATCH({
        locals: {},
        params: { id: 'c1' },
        request: makeRequest({ stage: 'lead' }),
      } as Parameters<typeof PATCH>[0]),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockSetFunnelStage).not.toHaveBeenCalled();
  });

  it('sets the funnel stage for a business org', async () => {
    mockGetCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
    mockGetTenant.mockResolvedValue({ kind: 'business' });
    mockSetFunnelStage.mockResolvedValue({ applied: true, stage: 'lead' });

    const { PATCH } = await import('./+server');
    const response = await PATCH({
      locals: {},
      params: { id: 'c1' },
      request: makeRequest({ stage: 'lead' }),
    } as Parameters<typeof PATCH>[0]);

    expect(response.status).toBe(200);
    expect(mockSetFunnelStage).toHaveBeenCalledWith(
      { db: {}, tenantId: 'org-1' },
      'c1',
      'lead',
      { by: 'user' },
    );
  });
});
