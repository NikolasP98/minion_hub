import { beforeEach, describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ core: vi.fn(), fresh: vi.fn(), capture: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: boundary.core }));
vi.mock('../fresh-org-authority', () => ({ resolveFreshOrgMemberWithCapability: boundary.fresh }));
vi.mock('@sentry/sveltekit', () => ({ captureException: boundary.capture }));
import { requireNotificationAdmission, requireNotificationRuleManager } from './authority';
const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const locals = () =>
  ({
    user: { id: 'canonical-user', supabaseId: actor, role: 'admin' },
    tenantCtx: { tenantId: org },
  }) as App.Locals;
beforeEach(() => {
  vi.resetAllMocks();
  boundary.core.mockResolvedValue({ tenantId: org, db: {} });
  boundary.fresh.mockResolvedValue({ profileId: actor, verifiedEmail: null });
});
describe('fresh notification authority', () => {
  it('admits an ordinary role through current comms manage with no email prerequisite', async () => {
    const own = locals();
    own.user!.role = 'user';
    expect(await requireNotificationRuleManager(own)).toMatchObject({
      tenantId: org,
      profileId: actor,
    });
    expect(boundary.fresh).toHaveBeenCalledExactlyOnceWith(org, actor, 'comms', 'manage');
  });
  it('does not let a cached platform-admin flag bypass removed membership or permission', async () => {
    boundary.fresh.mockResolvedValue(null);
    await expect(requireNotificationRuleManager(locals())).rejects.toMatchObject({ status: 403 });
  });
  it('rechecks every request so revocation changes the next result', async () => {
    await requireNotificationRuleManager(locals());
    boundary.fresh.mockResolvedValue(null);
    await expect(requireNotificationRuleManager(locals())).rejects.toMatchObject({ status: 403 });
    expect(boundary.fresh).toHaveBeenCalledTimes(2);
  });
  it('denies missing user session or current tenant before capability data', async () => {
    await expect(requireNotificationRuleManager({} as App.Locals)).rejects.toMatchObject({
      status: 401,
    });
    boundary.core.mockResolvedValue(null);
    await expect(requireNotificationRuleManager(locals())).rejects.toMatchObject({ status: 401 });
    expect(boundary.fresh).not.toHaveBeenCalled();
  });
  it('uses comms create for delegated direct sends and rejects noncanonical identity', async () => {
    await requireNotificationAdmission(org, actor, 'create');
    expect(boundary.fresh).toHaveBeenCalledExactlyOnceWith(org, actor, 'comms', 'create');
    await expect(
      requireNotificationAdmission(org, 'brain-unassigned', 'create'),
    ).rejects.toMatchObject({ status: 403 });
    expect(boundary.fresh).toHaveBeenCalledTimes(1);
  });
  it('reports fixed bounded failure telemetry and contains a throwing observer', async () => {
    boundary.fresh.mockRejectedValue(new Error('PRIVATE_SQL_AND_DESTINATION'));
    boundary.capture.mockImplementation(() => {
      throw new Error('observer unavailable');
    });
    await expect(requireNotificationAdmission(org, actor, 'create')).rejects.toMatchObject({
      status: 503,
      body: { message: 'Notification permissions are temporarily unavailable.' },
    });
    await expect(requireNotificationAdmission(org, actor, 'create')).rejects.toMatchObject({
      status: 503,
    });
    expect(boundary.capture).toHaveBeenCalledTimes(1);
    const [reported, context] = boundary.capture.mock.calls[0];
    expect(reported.message).toBe('Notification authority is unavailable');
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE|11111111|22222222/);
  });
});
