import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => ({ begin: mocks.begin }) }));

import {
  requireFreshReliabilityMember,
  resolveReliabilityReadTarget,
} from './reliability-read-authority';

const ACTOR = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const GATEWAY = '00000000-0000-0000-0000-000000000003';

function transaction(responses: unknown[][]) {
  const query = vi.fn((first: unknown) => {
    if (Array.isArray(first) && !Object.prototype.hasOwnProperty.call(first, 'raw')) {
      return first;
    }
    if (Array.isArray(first) && first.join(' ').includes('statement_timeout')) {
      return Promise.resolve([]);
    }
    return Promise.resolve(responses.shift() ?? []);
  });
  Object.assign(query, {
    unsafe: vi.fn(() => Promise.resolve(responses.shift() ?? [])),
  });
  mocks.begin.mockImplementationOnce(async (mode: string, work: (tx: unknown) => unknown) => {
    expect(mode).toBe('isolation level repeatable read read only');
    return work(query);
  });
  return query;
}

const member = (role: string | null = 'member', profileRole: string | null = 'user') => [
  { legacy_role: role, profile_role: profileRole, role_key: null, field_overflow: false },
];
const target = (orgId = ORG) => [
  {
    id: GATEWAY,
    legacy_server_id: 'legacy',
    org_id: orgId,
    url: 'wss://gateway.test',
    field_overflow: false,
  },
];

beforeEach(() => vi.clearAllMocks());

describe('fresh reliability authority', () => {
  it('binds membership, capability, canonical target and ordinary user link in one snapshot', async () => {
    const query = transaction([member(), [], target(), [{ linked: true }]]);
    await expect(
      resolveReliabilityReadTarget({ profileId: ACTOR, orgId: ORG, serverId: 'legacy' }),
    ).resolves.toEqual({
      profileId: ACTOR,
      orgId: ORG,
      gatewayId: GATEWAY,
      legacyServerId: 'legacy',
      gatewayUrl: 'wss://gateway.test',
      globalAdmin: false,
    });
    expect(query).toHaveBeenCalledTimes(4); // timeout, role interpolation, rule read and link read
    expect(
      (query as typeof query & { unsafe: ReturnType<typeof vi.fn> }).unsafe,
    ).toHaveBeenCalledTimes(2);
  });

  it('lets a freshly proven platform admin omit only the user-gateway link', async () => {
    const query = transaction([member('member', 'admin'), target()]);
    await expect(
      resolveReliabilityReadTarget({ profileId: ACTOR, orgId: ORG, serverId: GATEWAY }),
    ).resolves.toMatchObject({ gatewayId: GATEWAY, globalAdmin: true });
    expect(query).toHaveBeenCalledOnce();
    expect(
      (query as typeof query & { unsafe: ReturnType<typeof vi.fn> }).unsafe,
    ).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['removed membership', [[], [], target(), [{ linked: true }]], 403, 'membership_required'],
    [
      'missing capability',
      [member('viewer'), [], target(), [{ linked: true }]],
      403,
      'capability_required',
    ],
    [
      'foreign target',
      [member(), [], target('00000000-0000-0000-0000-000000000099')],
      404,
      'target_unavailable',
    ],
    ['missing link', [member(), [], target(), [{ linked: false }]], 404, 'target_unavailable'],
    ['ambiguous bridge', [member(), [], [...target(), ...target()]], 404, 'target_unavailable'],
  ] as const)('fails closed for %s', async (_name, responses, status, code) => {
    transaction(responses.map((rows) => [...rows]));
    await expect(
      resolveReliabilityReadTarget({ profileId: ACTOR, orgId: ORG, serverId: 'legacy' }),
    ).rejects.toMatchObject({ status, code });
  });

  it('requires valid canonical identity before opening a database snapshot', async () => {
    await expect(
      requireFreshReliabilityMember({ profileId: 'not-a-uuid', orgId: ORG }),
    ).rejects.toMatchObject({ status: 401, code: 'identity_required' });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('rejects the 65th role row before capability evaluation', async () => {
    transaction([
      Array.from({ length: 65 }, (_, index) => ({
        legacy_role: 'member',
        profile_role: 'user',
        role_key: `role-${index}`,
        field_overflow: false,
      })),
    ]);
    await expect(
      requireFreshReliabilityMember({ profileId: ACTOR, orgId: ORG }),
    ).rejects.toMatchObject({ status: 403, code: 'role_set_too_large' });
  });

  it('rejects SQL-marked authority and target field overflow', async () => {
    transaction([[{ ...member()[0], legacy_role: null, field_overflow: true }]]);
    await expect(
      requireFreshReliabilityMember({ profileId: ACTOR, orgId: ORG }),
    ).rejects.toMatchObject({ status: 403, code: 'authority_projection_invalid' });

    transaction([
      member(),
      [],
      [{ ...target()[0], legacy_server_id: null, url: null, field_overflow: true }],
    ]);
    await expect(
      resolveReliabilityReadTarget({ profileId: ACTOR, orgId: ORG, serverId: GATEWAY }),
    ).rejects.toMatchObject({ status: 404, code: 'target_unavailable' });
  });

  it('rejects an oversized server selector before opening a database snapshot', async () => {
    await expect(
      resolveReliabilityReadTarget({ profileId: ACTOR, orgId: ORG, serverId: 'x'.repeat(257) }),
    ).rejects.toMatchObject({ status: 404, code: 'target_unavailable' });
    expect(mocks.begin).not.toHaveBeenCalled();
  });
});
