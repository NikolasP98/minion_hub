import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  provision: vi.fn(),
  link: vi.fn(),
  hosts: vi.fn(),
  identities: vi.fn(),
  core: vi.fn(),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.core }));
vi.mock('$server/db/client', () => ({ getDb: vi.fn() }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));
vi.mock('$server/ai-usage', () => ({ setAiUsageOrg: vi.fn() }));
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAgent: mocks.agent,
  provisionPersonalAgent: mocks.provision,
}));
vi.mock('$server/services/gateway.pg.service', () => ({ ensureDefaultGatewayForUser: mocks.link }));
vi.mock('$server/services/hosts.service', () => ({ loadHostsForUser: mocks.hosts }));
vi.mock('$server/services/supabase-credential', () => ({
  listChannelIdentitiesFromSupabase: mocks.identities,
}));
import { load } from './+page.server';
const user = {
  id: 'synthetic-user',
  supabaseId: 'synthetic-profile',
  email: 'synthetic@example.test',
  displayName: null,
  role: 'user' as const,
};
function event(tenant = false) {
  return {
    locals: { user, ...(tenant ? { tenantCtx: { db: {} as never, tenantId: 'member-org' } } : {}) },
  } as Parameters<typeof load>[0];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent.mockResolvedValue(null);
  mocks.hosts.mockResolvedValue({ servers: [] });
  mocks.identities.mockResolvedValue([]);
});
it('redirects a verified no-org user to enrollment before any provisioning', async () => {
  await expect(load(event())).rejects.toMatchObject({ status: 303, location: '/join' });
  for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
});
it('preserves onboarding with an explicit tenant', async () => {
  await expect(load(event(true))).resolves.toMatchObject({
    user: { id: user.id },
    hosts: { servers: [] },
  });
  expect(mocks.link).toHaveBeenCalledWith(user.supabaseId, 'member-org');
  expect(mocks.provision).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: 'member-org' }),
    expect.objectContaining({ userId: user.id }),
  );
});
it('redirects an already active agent without provisioning again', async () => {
  mocks.agent.mockResolvedValue({ provisioningStatus: 'active' });
  await expect(load(event(true))).rejects.toMatchObject({ status: 303, location: '/' });
  expect(mocks.provision).not.toHaveBeenCalled();
  expect(mocks.link).not.toHaveBeenCalled();
});
