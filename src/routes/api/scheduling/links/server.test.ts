import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const isModuleEnabled = vi.fn();
const upsertLink = vi.fn();
const listLinks = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/services/scheduling.service', () => ({ upsertLink, listLinks }));

const { POST } = await import('./+server');

const body = () =>
  new Request('http://localhost/api/scheduling/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'consult', title: 'Consult' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ orgId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  upsertLink.mockResolvedValue('link-1');
});

describe('POST /api/scheduling/links', () => {
  it('org owner can create a booking link (org-gated, not platform-role-gated)', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });

    const response = await POST!({ locals: { role: 'owner' }, request: body() } as never);

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith({ role: 'owner' }, 'scheduling', 'manage');
    expect(upsertLink).toHaveBeenCalledOnce();
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(
      POST!({ locals: { role: 'viewer' }, request: body() } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(upsertLink).not.toHaveBeenCalled();
  });
});
