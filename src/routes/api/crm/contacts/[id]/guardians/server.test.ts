import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  requireOrgCapability: vi.fn(),
  getContact: vi.fn(),
  addGuardian: vi.fn(),
  removeGuardian: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: mocks.ownerFilter,
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/crm-contacts.service', () => ({ getContact: mocks.getContact }));
vi.mock('$server/services/crm-guardians.service', () => ({
  addGuardian: mocks.addGuardian,
  removeGuardian: mocks.removeGuardian,
  listGuardians: vi.fn(),
  isGuardianEligibilityFailure: () => false,
}));

const WARD = '11111111-1111-4111-8111-111111111111';
const GUARDIAN = '22222222-2222-4222-8222-222222222222';
const ctx = { db: {}, tenantId: 'org-1' };

function request(body: unknown): Request {
  return new Request(`http://localhost/api/crm/contacts/${WARD}/guardians`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(ctx);
  mocks.ownerFilter.mockResolvedValue(undefined);
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.getContact.mockResolvedValue({ contact: { id: WARD } });
  mocks.addGuardian.mockResolvedValue(undefined);
  mocks.removeGuardian.mockResolvedValue(undefined);
});

describe('POST /api/crm/contacts/[id]/guardians', () => {
  it('defaults to link and returns 201', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: {},
      params: { id: WARD },
      request: request({ guardianContactId: GUARDIAN }),
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(201);
    expect(mocks.addGuardian).toHaveBeenCalledWith(ctx, WARD, GUARDIAN);
    expect(mocks.removeGuardian).not.toHaveBeenCalled();
  });

  it('dispatches remove through the edit-gated POST and returns 200', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: {},
      params: { id: WARD },
      request: request({ guardianContactId: GUARDIAN, action: 'remove' }),
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(200);
    expect(mocks.removeGuardian).toHaveBeenCalledWith(ctx, WARD, GUARDIAN);
    expect(mocks.addGuardian).not.toHaveBeenCalled();
  });

  it('rejects an invalid route id before contact access', async () => {
    const { POST } = await import('./+server');
    await expect(
      POST({
        locals: {},
        params: { id: 'not-a-uuid' },
        request: request({ guardianContactId: GUARDIAN }),
      } as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.getContact).not.toHaveBeenCalled();
  });

  it('rejects an invalid body without dispatching a mutation', async () => {
    const { POST } = await import('./+server');
    await expect(
      POST({
        locals: {},
        params: { id: WARD },
        request: request({ guardianContactId: 'not-a-uuid', action: 'remove' }),
      } as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.addGuardian).not.toHaveBeenCalled();
    expect(mocks.removeGuardian).not.toHaveBeenCalled();
  });
});

describe('GET /api/crm/contacts/[id]/guardians', () => {
  it('denies callers without CRM view before reading the contact', async () => {
    mocks.requireOrgCapability.mockRejectedValueOnce(
      Object.assign(new Error('crm: view required'), { status: 403 }),
    );
    const { GET } = await import('./+server');

    await expect(
      GET({ locals: {}, params: { id: WARD } } as Parameters<typeof GET>[0]),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'view');
    expect(mocks.getContact).not.toHaveBeenCalled();
  });
});
