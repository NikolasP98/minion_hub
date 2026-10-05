import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  resolveTarget: vi.fn(),
  admission: vi.fn(),
  telemetry: vi.fn(),
  insights: vi.fn(),
  skills: vi.fn(),
  credentials: vi.fn(),
  getCoreDb: vi.fn(),
  rekey: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAuth: mocks.requireAuth,
  requireTenantCtx: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.getCoreDb }));
vi.mock('$server/services/reliability-read-authority', () => ({
  resolveReliabilityReadTarget: mocks.resolveTarget,
}));
vi.mock('$server/services/reliability-read-admission', () => ({
  withReliabilityReadAdmission: mocks.admission,
}));
vi.mock('$server/services/reliability-telemetry-read', () => ({
  withOwnedTelemetryRead: mocks.telemetry,
}));
vi.mock('$server/services/reliability-insights-read', () => ({
  readReliabilityInsights: mocks.insights,
}));
vi.mock('$server/services/skill-stats.service', () => ({
  insertSkillStats: vi.fn(),
  readAuthorizedSkillStats: mocks.skills,
}));
vi.mock('$server/services/credential-health.service', () => ({
  insertCredentialHealthSnapshot: vi.fn(),
}));
vi.mock('$server/services/reliability-credential-read', () => ({
  readCredentialHealthSnapshots: mocks.credentials,
}));

import { GET as getInsights } from '../../routes/api/reliability/insights/+server';
import { GET as getSkillStats } from '../../routes/api/metrics/skill-stats/+server';
import { GET as getCredentialHealth } from '../../routes/api/metrics/credential-health/+server';

const UUID = '00000000-0000-0000-0000-000000000001';

function event(url: string) {
  return { locals: { orgId: UUID }, url: new URL(url) } as never;
}

describe('fresh-authority reliability GET routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue({ supabaseId: UUID });
    mocks.resolveTarget.mockResolvedValue({
      profileId: UUID,
      orgId: UUID,
      gatewayId: '00000000-0000-0000-0000-000000000002',
      legacyServerId: 'legacy-server',
      gatewayUrl: 'wss://gateway.test',
      globalAdmin: false,
    });
    mocks.admission.mockImplementation(
      async (_key: string, work: (signal: AbortSignal, rekey: (key: string) => void) => unknown) =>
        work(new AbortController().signal, mocks.rekey),
    );
    mocks.telemetry.mockImplementation(
      async (_signal: AbortSignal, work: (tx: object) => unknown) => work({}),
    );
    mocks.insights.mockResolvedValue({ window: { from: 0, to: 1 } });
    mocks.skills.mockResolvedValue({ bySkill: [] });
    mocks.credentials.mockResolvedValue([]);
  });

  it.each([
    [
      'insights',
      getInsights,
      'https://hub.test/api/reliability/insights?serverId=legacy-server&from=0&to=1',
    ],
    [
      'skill stats',
      getSkillStats,
      'https://hub.test/api/metrics/skill-stats?serverId=legacy-server&from=0&to=1&summary=true',
    ],
    [
      'credential health',
      getCredentialHealth,
      'https://hub.test/api/metrics/credential-health?serverId=legacy-server&from=0&to=1&limit=1',
    ],
  ] as const)(
    'admits %s before fresh authority and rekeys its data access',
    async (_name, handler, url) => {
      const response = await handler(event(url));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.resolveTarget).toHaveBeenCalledWith({
        profileId: UUID,
        orgId: UUID,
        serverId: 'legacy-server',
      });
      expect(mocks.admission).toHaveBeenCalledOnce();
      expect(mocks.admission).toHaveBeenCalledWith(
        JSON.stringify(['requested', UUID, UUID, 'legacy-server']),
        expect.any(Function),
      );
      expect(mocks.rekey).toHaveBeenCalledWith(
        JSON.stringify(['target', UUID, '00000000-0000-0000-0000-000000000002']),
      );
    },
  );

  it.each([
    ['insights', getInsights, 'https://hub.test/api/reliability/insights?serverId=s&serverId=s'],
    ['skill stats', getSkillStats, 'https://hub.test/api/metrics/skill-stats?serverId=s&limit=0'],
    [
      'credential health',
      getCredentialHealth,
      'https://hub.test/api/metrics/credential-health?serverId=s&unknown=1',
    ],
  ] as const)(
    'rejects invalid %s input before authority or data access',
    async (_name, handler, url) => {
      await expect(handler(event(url))).rejects.toMatchObject({ status: 400 });
      expect(mocks.resolveTarget).not.toHaveBeenCalled();
      expect(mocks.admission).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['foreign gateway', 404, 'target_unavailable'],
    ['removed membership', 403, 'membership_required'],
    ['removed capability', 403, 'capability_required'],
    ['stale admin', 403, 'target_link_required'],
    ['ambiguous bridge', 404, 'target_unavailable'],
  ] as const)(
    'does not touch telemetry when admitted authority rejects %s',
    async (_name, status, code) => {
      mocks.resolveTarget.mockRejectedValueOnce(
        Object.assign(new Error('private'), { status, code }),
      );
      await expect(
        getInsights(
          event('https://hub.test/api/reliability/insights?serverId=foreign&from=0&to=1'),
        ),
      ).rejects.toMatchObject({ status });
      expect(mocks.admission).toHaveBeenCalledOnce();
      expect(mocks.rekey).not.toHaveBeenCalled();
      expect(mocks.telemetry).not.toHaveBeenCalled();
      expect(mocks.insights).not.toHaveBeenCalled();
    },
  );

  it('lets canonical-only skill reads proceed but leaves legacy telemetry unavailable', async () => {
    mocks.resolveTarget.mockResolvedValueOnce({
      profileId: UUID,
      orgId: UUID,
      gatewayId: '00000000-0000-0000-0000-000000000002',
      legacyServerId: null,
      gatewayUrl: 'wss://gateway.test',
      globalAdmin: false,
    });
    await getSkillStats(
      event('https://hub.test/api/metrics/skill-stats?serverId=canonical&from=0&to=1'),
    );
    expect(mocks.skills).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: UUID, profileId: UUID }),
      '00000000-0000-0000-0000-000000000002',
      expect.any(Object),
    );

    mocks.resolveTarget.mockResolvedValueOnce({
      profileId: UUID,
      orgId: UUID,
      gatewayId: '00000000-0000-0000-0000-000000000002',
      legacyServerId: null,
      gatewayUrl: 'wss://gateway.test',
      globalAdmin: false,
    });
    mocks.insights.mockImplementationOnce((_tx, legacy) => {
      expect(legacy).toBeNull();
      throw Object.assign(new Error('missing bridge'), {
        status: 404,
        code: 'telemetry_target_unavailable',
      });
    });
    await expect(
      getInsights(
        event('https://hub.test/api/reliability/insights?serverId=canonical&from=0&to=1'),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
