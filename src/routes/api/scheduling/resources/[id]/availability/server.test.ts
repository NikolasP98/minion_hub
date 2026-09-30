import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const getCoreCtx = vi.fn();
const isModuleEnabled = vi.fn();
const ensureResourceSchedule = vi.fn();
const getResourceSchedule = vi.fn();
const replaceAvailability = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled }));
vi.mock('$server/services/scheduling.service', () => ({
  ensureResourceSchedule,
  getResourceSchedule,
  replaceAvailability,
}));

const { PUT } = await import('./+server');

const put = (rules: unknown[]) =>
  new Request('http://localhost/api/scheduling/resources/res-1/availability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockResolvedValue({ can: () => true });
  getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  isModuleEnabled.mockResolvedValue(true);
});

describe('PUT /api/scheduling/resources/[id]/availability', () => {
  it('saves for a resource that had NO schedule row — the schedule is created, never a 404', async () => {
    // Prod 2026-09-30: a staff resource inserted outside createResource had no
    // sched_schedules row, so the editor's Save was dead. ensure() creates it.
    ensureResourceSchedule.mockResolvedValue({
      scheduleId: 'sch-new',
      timezone: 'America/Lima',
      rules: [],
    });

    const res = await PUT!({
      locals: {},
      request: put([{ days: [6], startTime: '09:00', endTime: '17:00', date: null }]),
      params: { id: 'res-1' },
    } as never);

    expect(res.status).toBe(200);
    expect(ensureResourceSchedule).toHaveBeenCalledWith({ tenantId: 'org-1' }, 'res-1');
    expect(replaceAvailability).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      'sch-new',
      'America/Lima',
      [{ days: [6], startTime: '09:00', endTime: '17:00', date: null }],
    );
  });

  it('404s only when the resource itself is unknown to the org', async () => {
    ensureResourceSchedule.mockRejectedValue(new Error('resource not found'));

    await expect(
      PUT!({ locals: {}, request: put([]), params: { id: 'nope' } } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(replaceAvailability).not.toHaveBeenCalled();
  });
});
