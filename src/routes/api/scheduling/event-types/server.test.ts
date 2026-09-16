import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const isModuleEnabled = vi.fn();
const upsertEventType = vi.fn();
const listEventTypes = vi.fn();
const parseScheduleRules = vi.fn((v: unknown) => v);

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/services/scheduling.service', () => ({
  upsertEventType,
  listEventTypes,
  parseScheduleRules,
}));

const { POST } = await import('./+server');

const body = () =>
  new Request('http://localhost/api/scheduling/event-types', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'consult', title: 'Consult', length: 30 }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getCoreCtx.mockResolvedValue({ orgId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
  upsertEventType.mockResolvedValue('event-type-1');
});

describe('POST /api/scheduling/event-types', () => {
  it('org owner can create an event type (org-gated, not platform-role-gated)', async () => {
    requireOrgCapability.mockResolvedValue({ can: () => true });

    const response = await POST!({ locals: { role: 'owner' }, request: body() } as never);

    expect(response.status).toBe(200);
    expect(requireOrgCapability).toHaveBeenCalledWith({ role: 'owner' }, 'scheduling', 'manage');
    expect(upsertEventType).toHaveBeenCalledOnce();
  });

  it('viewer is rejected before any write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });

    await expect(
      POST!({ locals: { role: 'viewer' }, request: body() } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(upsertEventType).not.toHaveBeenCalled();
  });
});
