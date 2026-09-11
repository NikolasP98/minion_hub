import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mocks = vi.hoisted(() => ({
  getCoreDb: vi.fn(),
  admin: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.getCoreDb }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: mocks.admin }));
vi.mock('$server/services/rbac.service', () => ({ resolveCapabilities: mocks.capabilities }));

import { resolveAssistantPrincipal } from './assistant-principal';
import { requireAssistantCapability } from '../../routes/api/gateway/_shared/action-auth';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE = '22222222-2222-4222-8222-222222222222';
const GATEWAY = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const OTHER_ORG = '55555555-5555-4555-8555-555555555555';
const AGENT = `personal-${PROFILE}`;
const BRAIN = 'brain-66666666-6666-4666-8666-666666666666';
const assignment = {
  gatewayId: GATEWAY,
  legacyServerId: 'legacy-server',
  orgId: ORG,
  principalId: PROFILE,
  agentId: AGENT,
  provisioningStatus: 'active',
};
const member = { organization_id: ORG, role: 'member' };
const capabilities = {
  can: vi.fn(() => true),
  canRunAnalytics: () => true,
};

function url(params: Record<string, string | undefined>) {
  const result = new URL('https://hub.test/api/gateway/query/finance');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) result.searchParams.set(key, value);
  }
  return result;
}

function gatewayLocals(serverId = GATEWAY): App.Locals {
  return { serverId, tenantCtx: { db: {} as never, tenantId: ORG } };
}

function browserLocals(profileId = PROFILE, role: 'user' | 'admin' = 'user'): App.Locals {
  return {
    user: {
      id: profileId,
      supabaseId: profileId,
      email: 'person@example.test',
      displayName: null,
      role,
    },
    orgId: ORG,
    tenantCtx: { db: {} as never, tenantId: ORG },
  };
}

function membershipFixture(rows = [member], failure: unknown = null) {
  const result = { data: rows, error: failure };
  const eq = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: PROFILE }, error: null }),
          })),
        })),
      };
    }
    return { select };
  });
  mocks.admin.mockReturnValue({ from });
  return { from, select, eq };
}

function dataFixture(rows: unknown[]) {
  const fixture = createMockDb();
  fixture.resolve(rows);
  mocks.getCoreDb.mockReturnValue(fixture.db);
  return fixture;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities.mockResolvedValue(capabilities);
  capabilities.can.mockReturnValue(true);
  membershipFixture();
});

describe('gateway actor assignment', () => {
  it.each([GATEWAY, 'legacy-server'])(
    'accepts the active personal agent assigned to %s',
    async (serverId) => {
      dataFixture([assignment]);
      const result = await resolveAssistantPrincipal(
        gatewayLocals(serverId),
        url({ agentId: AGENT }),
      );
      expect(result).toEqual({ principalId: PROFILE, orgId: ORG, role: 'member', capabilities });
      expect(mocks.capabilities).toHaveBeenCalledWith(ORG, PROFILE);
    },
  );

  it('matches a legacy mixed-case agent id literally and case-insensitively', async () => {
    dataFixture([{ ...assignment, agentId: 'Personal-Legacy_User' }]);
    const result = await resolveAssistantPrincipal(
      gatewayLocals(),
      url({ agentId: 'personal-legacy_user' }),
    );
    expect(result.principalId).toBe(PROFILE);
  });

  it.each([
    ['missing', []],
    ['ambiguous', [assignment, { ...assignment, principalId: OTHER_PROFILE }]],
    ['different gateway', [{ ...assignment, gatewayId: 'other-gateway', legacyServerId: null }]],
    ['different actor', [{ ...assignment, agentId: 'personal-other' }]],
    ['inactive actor', [{ ...assignment, provisioningStatus: 'pending' }]],
    ['unassigned org', [{ ...assignment, orgId: null }]],
    ['stale token org', [{ ...assignment, orgId: OTHER_ORG }]],
  ])('denies %s assignment before resolving capabilities', async (_label, rows) => {
    dataFixture(rows);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
    });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('does not use wildcard matching for a caller-supplied agent id', async () => {
    dataFixture([assignment]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: 'personal-%' })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('requires a gateway tenant even if browser admin locals are also present', async () => {
    const locals = { ...browserLocals(PROFILE, 'admin'), serverId: GATEWAY, tenantCtx: undefined };
    await expect(resolveAssistantPrincipal(locals, url({ agentId: AGENT }))).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
    });
    expect(mocks.getCoreDb).not.toHaveBeenCalled();
  });

  it.each([{ userId: OTHER_PROFILE }, { agentId: AGENT, userId: OTHER_PROFILE }])(
    'rejects a gateway userId override without identity lookup',
    async (params) => {
      await expect(resolveAssistantPrincipal(gatewayLocals(), url(params))).rejects.toMatchObject({
        status: 403,
        body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
      });
      expect(mocks.getCoreDb).not.toHaveBeenCalled();
      expect(mocks.admin).not.toHaveBeenCalled();
    },
  );

  it('denies a brain gateway call because no gateway assignment is persisted', async () => {
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: BRAIN })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_BRAIN_ASSIGNMENT_REQUIRED' } });
    expect(mocks.getCoreDb).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('rejects another requested org even when the principal belongs to both', async () => {
    dataFixture([assignment]);
    membershipFixture([member, { organization_id: OTHER_ORG, role: 'owner' }]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT, orgId: OTHER_ORG })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('fails closed after organization membership is removed', async () => {
    dataFixture([assignment]);
    membershipFixture([]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
  });

  it('does not cache a removed agent assignment', async () => {
    const { resolveSequence } = dataFixture([]);
    resolveSequence([[assignment], [assignment], [assignment], []]);
    await resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT }));
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.getCoreDb).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['ambiguous actor', [assignment, { ...assignment, principalId: OTHER_PROFILE }]],
    ['actor on another gateway', [{ ...assignment, gatewayId: 'other-gateway' }]],
    ['gateway reassigned during actor lookup', [{ ...assignment, orgId: OTHER_ORG }]],
  ])('denies %s after resolving an unambiguous gateway', async (_label, rows) => {
    const { resolveSequence } = dataFixture([]);
    resolveSequence([[assignment], rows]);
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({
      status: 403,
      body: { code: 'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED' },
    });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('sanitizes a gateway registry failure without granting authority', async () => {
    mocks.getCoreDb.mockImplementationOnce(() => {
      throw new Error('private connection detail');
    });
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({
      status: 503,
      body: {
        code: 'ASSISTANT_IDENTITY_UNAVAILABLE',
        message: 'Assistant identity is temporarily unavailable.',
      },
    });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it('does not convert an identity backend error into authority', async () => {
    dataFixture([assignment]);
    membershipFixture([], { message: 'private backend detail' });
    await expect(
      resolveAssistantPrincipal(gatewayLocals(), url({ agentId: AGENT })),
    ).rejects.toMatchObject({ status: 503, body: { code: 'ASSISTANT_IDENTITY_UNAVAILABLE' } });
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });
});

describe('browser actor authorization', () => {
  it('preserves a browser user reading as themself', async () => {
    const result = await resolveAssistantPrincipal(browserLocals(), url({ userId: PROFILE }));
    expect(result.principalId).toBe(PROFILE);
    expect(result.orgId).toBe(ORG);
  });

  it('preserves an authenticated admin selecting a member', async () => {
    const result = await resolveAssistantPrincipal(
      browserLocals(OTHER_PROFILE, 'admin'),
      url({ userId: PROFILE }),
    );
    expect(result.principalId).toBe(PROFILE);
  });

  it('denies a browser member selecting another user before membership lookup', async () => {
    await expect(
      resolveAssistantPrincipal(browserLocals(), url({ userId: OTHER_PROFILE })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('requires browser authentication before looking up an agent', async () => {
    await expect(resolveAssistantPrincipal({}, url({ agentId: AGENT }))).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.getCoreDb).not.toHaveBeenCalled();
  });

  it('resolves the browser agent from its persisted owner without writing identity pointers', async () => {
    dataFixture([assignment]);
    const fixture = membershipFixture();
    const result = await resolveAssistantPrincipal(browserLocals(), url({ agentId: AGENT }));
    expect(result.principalId).toBe(PROFILE);
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith('organization_members');
  });

  it('denies an explicitly requested nonmember org rather than choosing another org', async () => {
    await expect(
      resolveAssistantPrincipal(browserLocals(), url({ userId: PROFILE, orgId: OTHER_ORG })),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
  });

  it('preserves brain-only capabilities for an authenticated admin', async () => {
    dataFixture([{ orgId: ORG }]);
    const principal = await resolveAssistantPrincipal(
      browserLocals(PROFILE, 'admin'),
      url({ agentId: BRAIN }),
    );
    expect(principal.principalId).toBe(BRAIN);
    expect(principal.orgId).toBe(ORG);
    expect(principal.capabilities.can('brains', 'view')).toBe(true);
    expect(principal.capabilities.can('brains', 'edit')).toBe(true);
    expect(principal.capabilities.can('crm', 'view')).toBe(false);
    expect(principal.capabilities.canRunAnalytics()).toBe(false);
  });

  it('does not resolve an unknown brain even for an admin', async () => {
    dataFixture([]);
    await expect(
      resolveAssistantPrincipal(browserLocals(PROFILE, 'admin'), url({ agentId: BRAIN })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a browser member claiming a brain identity before looking it up', async () => {
    await expect(
      resolveAssistantPrincipal(browserLocals(), url({ agentId: BRAIN })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.getCoreDb).not.toHaveBeenCalled();
  });

  it('rejects a brain request for an organization other than its own', async () => {
    dataFixture([{ orgId: ORG }]);
    await expect(
      resolveAssistantPrincipal(
        browserLocals(PROFILE, 'admin'),
        url({ agentId: BRAIN, orgId: OTHER_ORG }),
      ),
    ).rejects.toMatchObject({ status: 403, body: { code: 'ASSISTANT_ORG_NOT_ASSIGNED' } });
  });

  it('does not grant an admin brain principal a non-brain tool capability', async () => {
    dataFixture([{ orgId: ORG }]);
    await expect(
      requireAssistantCapability(
        browserLocals(PROFILE, 'admin'),
        url({ agentId: BRAIN }),
        'crm',
        'edit',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
