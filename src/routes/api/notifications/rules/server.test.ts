import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  fresh: vi.fn(),
  core: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  health: vi.fn(),
}));
vi.mock('$server/services/fresh-org-authority', () => ({
  resolveFreshOrgMemberWithCapability: calls.fresh,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: calls.core }));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));
vi.mock('$server/services/notif.service', () => ({
  listRules: calls.list,
  createRule: calls.create,
  updateRule: calls.update,
  deleteRule: calls.remove,
  NOTIF_TABLES: [],
}));
vi.mock('$server/services/notifications/worker-health', () => ({
  readNotificationWorkerHealth: calls.health,
}));
import { GET, POST } from './+server';
import { PATCH, DELETE } from './[id]/+server';
import { load } from '../../../(app)/settings/notifications/+page.server';
const org = '11111111-1111-4111-8111-111111111111';
const profile = '22222222-2222-4222-8222-222222222222';
const event = (method = 'POST') =>
  ({
    locals: {
      user: { id: 'user', supabaseId: profile, role: 'admin' },
      tenantCtx: { tenantId: org },
    },
    params: { id: 'rule' },
    depends: vi.fn(),
    request: new Request('http://localhost/api/notifications/rules', {
      method,
      body: JSON.stringify({
        name: 'Rule',
        triggerTable: 'support_issues',
        triggerEvent: 'insert',
        channel: 'email',
        template: 'Notice',
      }),
      headers: { 'content-type': 'application/json' },
    }),
  }) as never;
beforeEach(() => {
  vi.resetAllMocks();
  calls.core.mockResolvedValue({ tenantId: org, db: {}, profileId: profile });
  calls.fresh.mockResolvedValue({ profileId: profile, verifiedEmail: null });
  calls.list.mockResolvedValue([]);
  calls.create.mockResolvedValue({ id: 'rule' });
  calls.update.mockResolvedValue({ id: 'rule' });
  calls.health.mockResolvedValue({ checkedAt: '2026-10-03T12:00:00.000Z' });
});
describe('actual notification rule routes share fresh organization authority', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
    ['settings load', load],
  ] as const)(
    'denies %s before storage even for a cached administrator',
    async (_name, handler) => {
      calls.fresh.mockResolvedValue(null);
      await expect(handler(event())).rejects.toMatchObject({ status: 403 });
      for (const fn of [calls.list, calls.create, calls.update, calls.remove])
        expect(fn).not.toHaveBeenCalled();
      expect(calls.fresh).toHaveBeenCalledExactlyOnceWith(org, profile, 'comms', 'manage');
    },
  );
  it('allows current organization managers through the creation route', async () => {
    const requestEvent = event() as unknown as Parameters<typeof POST>[0];
    requestEvent.locals.user!.role = 'user';
    const response = await POST(requestEvent);
    expect(response.status).toBe(201);
    expect(calls.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: org, profileId: profile }),
      expect.objectContaining({ name: 'Rule' }),
    );
  });

  it('keeps editable legacy rules when only worker health is unavailable', async () => {
    calls.list.mockResolvedValue([{ id: 'rule' }]);
    calls.health.mockRejectedValue(new Error('private database detail'));
    const result = await load(event());
    if (!result) throw new Error('Expected notification settings page data');
    expect(result.rules).toEqual([{ id: 'rule' }]);
    expect(result.healthSeed).toEqual({
      actorId: profile,
      orgId: org,
      status: 'unavailable',
    });
  });
});
