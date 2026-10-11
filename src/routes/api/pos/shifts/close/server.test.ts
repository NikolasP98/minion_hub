import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shifts are per user: closing YOUR OWN register is a `pos: edit` operation
 * (the central write guard already covers it), while counting someone else's
 * must hold `pos: manage`. These two tests pin exactly that split — the
 * capability call is the authorization, so asserting whether it happens is
 * asserting the rule.
 */
const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  closeShift: vi.fn(),
  listOpenShifts: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => mocks.requireOrgCapability(...args),
}));
vi.mock('$server/services/pos.service', () => ({
  closeShift: (...args: unknown[]) => mocks.closeShift(...args),
  listOpenShifts: () => mocks.listOpenShifts(),
}));
import { POST } from './+server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeShift.mockResolvedValue({ id: 's1' });
  mocks.listOpenShifts.mockResolvedValue([
    { id: 's1', openedBy: 'me', openedAt: new Date() },
    { id: 's2', openedBy: 'colleague', openedAt: new Date() },
  ]);
});

function post(body: unknown) {
  const url = new URL('http://localhost/api/pos/shifts/close');
  return {
    locals: {},
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0];
}

describe('POST /api/pos/shifts/close', () => {
  it('closes the caller’s own register without the manager capability', async () => {
    const res = await POST(post({ counted: { cash: 10 } }));
    expect(res.status).toBe(200);
    expect(mocks.requireOrgCapability).not.toHaveBeenCalled();
    expect(mocks.closeShift.mock.calls[0][1]).toMatchObject({ shiftId: undefined });
  });

  it('requires pos:manage to count someone else’s register', async () => {
    mocks.requireOrgCapability.mockRejectedValue(new Error('403'));
    await expect(
      POST(post({ counted: {}, shiftId: '00000000-0000-4000-8000-000000000002' })),
    ).rejects.toThrow('403');
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'pos', 'manage');
    expect(mocks.closeShift).not.toHaveBeenCalled();
  });

  it('closes a shift the caller owns even when named explicitly', async () => {
    mocks.listOpenShifts.mockResolvedValue([
      { id: '00000000-0000-4000-8000-000000000001', openedBy: 'me', openedAt: new Date() },
    ]);
    const res = await POST(post({ counted: {}, shiftId: '00000000-0000-4000-8000-000000000001' }));
    expect(res.status).toBe(200);
    expect(mocks.requireOrgCapability).not.toHaveBeenCalled();
  });
});
