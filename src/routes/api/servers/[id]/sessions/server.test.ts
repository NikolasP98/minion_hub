import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spec 117 D8: a member lists only their assistant's stored sessions.
const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getPersonalAssistantId: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: async () => ({ db: {}, tenantId: 'org-a' }),
}));
vi.mock('$server/services/session.service', () => ({
  listSessions: mocks.listSessions,
  upsertSession: vi.fn(),
}));
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAssistantId: mocks.getPersonalAssistantId,
}));

import { GET } from './+server';

const admin = { id: 'admin-1', role: 'admin', supabaseId: 'p-admin' };
const member = { id: 'u-1', role: 'user', supabaseId: 'p-1' };
const rows = [
  { id: 's1', agentId: 'Personal-Legacy-ABC', sessionKey: 'agent:personal-legacy-abc:main' },
  { id: 's2', agentId: 'personal-other', sessionKey: 'agent:personal-other:main' },
  { id: 's3', agentId: 'main', sessionKey: 'agent:main:main' },
];

const event = (user: object) => ({ locals: { user }, params: { id: 'server-1' } }) as never;
const ids = async (res: Response) =>
  ((await res.json()) as { sessions: { id: string }[] }).sessions.map((s) => s.id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSessions.mockResolvedValue(rows);
  mocks.getPersonalAssistantId.mockResolvedValue('personal-legacy-abc');
});

describe('GET /api/servers/[id]/sessions', () => {
  test('a platform admin lists every session', async () => {
    expect(await ids(await GET(event(admin)))).toEqual(['s1', 's2', 's3']);
    expect(mocks.getPersonalAssistantId).not.toHaveBeenCalled();
  });

  test('a member lists only their assistant sessions', async () => {
    expect(await ids(await GET(event(member)))).toEqual(['s1']);
    expect(mocks.getPersonalAssistantId).toHaveBeenCalledWith('p-1');
  });

  test('a member without an assistant lists nothing', async () => {
    mocks.getPersonalAssistantId.mockResolvedValue(null);
    expect(await ids(await GET(event(member)))).toEqual([]);
  });
});
