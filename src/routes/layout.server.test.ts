import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$server/services/tenant.service', () => ({ getTenant: vi.fn() }));
import { getTenant } from '$server/services/tenant.service';
import { load } from './+layout.server';
const event = (routeId: string, authenticated = true) =>
  ({
    locals: {
      user: authenticated ? { id: 'actor' } : null,
      tenantCtx: authenticated ? { tenantId: 'org-a', db: {} } : null,
    },
    route: { id: routeId },
    depends: vi.fn(),
  }) as unknown as Parameters<typeof load>[0];
beforeEach(() => vi.resetAllMocks());
it('avoids the duplicate app read and registers scoped refresh dependencies', async () => {
  const e = event('/(app)/home');
  expect(await load(e)).toHaveProperty('branding.fullName', 'MINION Hub');
  expect(getTenant).not.toHaveBeenCalled();
  expect(e.depends).toHaveBeenCalledWith('app:user', 'app:branding');
});
it('keeps no-org public requests at the default without a database read', async () => {
  expect(await load(event('/login', false))).toHaveProperty('branding.orgId', null);
  expect(getTenant).not.toHaveBeenCalled();
});
it('uses only verified non-app org identity', async () => {
  vi.mocked(getTenant).mockResolvedValue({ id: 'org-a', name: 'Faces', hub_name: null } as never);
  expect(await load(event('/onboarding'))).toHaveProperty('branding.fullName', 'Faces Hub');
  expect(getTenant).toHaveBeenCalledTimes(1);
});
it('cannot reuse a foreign identity or a failed read', async () => {
  vi.mocked(getTenant).mockResolvedValueOnce({ id: 'foreign', name: 'Foreign' } as never);
  expect(await load(event('/login'))).toHaveProperty('branding', {
    orgId: 'org-a',
    name: 'MINION',
    fullName: 'MINION Hub',
    source: 'default',
    readStatus: 'unavailable',
  });
  vi.mocked(getTenant).mockRejectedValueOnce(new Error('read failed'));
  expect(await load(event('/login'))).toHaveProperty('branding.readStatus', 'unavailable');
});
