import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  provisionOrganization: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (locals: unknown) => mocks.requireAdmin(locals),
}));
vi.mock('$server/services/organization-provision.service', () => ({
  provisionOrganization: (...args: unknown[]) => mocks.provisionOrganization(...args),
}));

import { POST } from './+server';

function event(body: unknown) {
  return {
    locals: { user: { id: 'admin-1', role: 'admin', supabaseId: 'profile-1' } },
    request: new Request('http://localhost/api/organizations/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockReturnValue({ id: 'admin-1', role: 'admin', supabaseId: 'profile-1' });
});

describe('POST /api/organizations/provision', () => {
  it('rejects non-admin callers before provisioning', async () => {
    mocks.requireAdmin.mockImplementation(() => {
      throw { status: 403 };
    });
    await expect(POST(event({ name: 'PINONITE' }))).rejects.toMatchObject({ status: 403 });
    expect(mocks.provisionOrganization).not.toHaveBeenCalled();
  });

  it('runs the provisioner as the authenticated Supabase profile', async () => {
    mocks.provisionOrganization.mockResolvedValue({ ok: true, organization: { id: 'org-3' }, steps: [] });
    const requestEvent = event({ name: 'PINONITE' });
    const response = await POST(requestEvent);
    expect(response.status).toBe(200);
    expect(mocks.provisionOrganization).toHaveBeenCalledWith(requestEvent, {
      name: 'PINONITE',
      profileId: 'profile-1',
      existingWorkforceCompanyId: undefined,
    });
  });

  it('returns a traced failure without hiding completed steps', async () => {
    mocks.provisionOrganization.mockResolvedValue({
      ok: false,
      organization: { id: 'org-3' },
      steps: [{ id: 'workforce', status: 'failed', detail: 'backend unavailable', durationMs: 4 }],
    });
    const response = await POST(event({ name: 'PINONITE' }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ ok: false, organization: { id: 'org-3' } });
  });
});
