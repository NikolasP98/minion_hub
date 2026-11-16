import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spec 117 D8: stored chat rows belong to the person whose assistant they are.
const mocks = vi.hoisted(() => ({
  listChatMessagesBySessionKey: vi.fn(),
  bulkInsertChatMessages: vi.fn(),
  getPersonalAssistantId: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: async () => ({ db: {}, tenantId: 'org-a' }),
}));
vi.mock('$server/services/chat.service', () => ({
  listChatMessagesBySessionKey: mocks.listChatMessagesBySessionKey,
  bulkInsertChatMessages: mocks.bulkInsertChatMessages,
}));
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAssistantId: mocks.getPersonalAssistantId,
}));

import { GET, POST } from './+server';

const admin = { id: 'admin-1', role: 'admin', supabaseId: 'p-admin' };
const member = { id: 'u-1', role: 'user', supabaseId: 'p-1' };
const OWN = 'agent:personal-legacy-abc:main';
const FOREIGN = 'agent:personal-other:main';

function event(user: object, sessionKey: string, body: unknown = { messages: [] }) {
  return {
    locals: { user },
    params: { id: 'server-1', sessionKey: encodeURIComponent(sessionKey) },
    request: { json: async () => body },
  } as never;
}

const forbidden = { status: 403, body: { message: expect.stringMatching(/role cannot/i) } };

beforeEach(() => {
  vi.clearAllMocks();
  // Stored mixed-case on purpose: the comparison is case-insensitive.
  mocks.getPersonalAssistantId.mockResolvedValue('Personal-Legacy-ABC');
  mocks.listChatMessagesBySessionKey.mockResolvedValue([{ id: 'm1' }]);
});

describe('GET stored session messages', () => {
  test('a platform admin reads any session', async () => {
    const res = await GET(event(admin, FOREIGN));
    expect(await res.json()).toEqual({ messages: [{ id: 'm1' }] });
    expect(mocks.getPersonalAssistantId).not.toHaveBeenCalled();
  });

  test('a member reads their own assistant session', async () => {
    const res = await GET(event(member, OWN));
    expect(await res.json()).toEqual({ messages: [{ id: 'm1' }] });
    expect(mocks.getPersonalAssistantId).toHaveBeenCalledWith('p-1');
  });

  test.each([FOREIGN, 'agent:main:main', 'main'])(
    'a member is refused %s before any row is read',
    async (key) => {
      await expect(GET(event(member, key))).rejects.toMatchObject(forbidden);
      expect(mocks.listChatMessagesBySessionKey).not.toHaveBeenCalled();
    },
  );

  test('a member without an assistant is refused', async () => {
    mocks.getPersonalAssistantId.mockResolvedValue(null);
    await expect(GET(event(member, OWN))).rejects.toMatchObject(forbidden);
  });
});

describe('POST stored session messages', () => {
  const body = { messages: [{ role: 'user', content: 'hola' }] };

  test('a platform admin writes any session', async () => {
    const res = await POST(event(admin, FOREIGN, body));
    expect(await res.json()).toEqual({ ok: true, count: 1 });
  });

  test('a member writes their own assistant session', async () => {
    const res = await POST(event(member, OWN, body));
    expect(await res.json()).toEqual({ ok: true, count: 1 });
    expect(mocks.bulkInsertChatMessages).toHaveBeenCalledTimes(1);
  });

  test('a member is refused a foreign session and nothing is written', async () => {
    await expect(POST(event(member, FOREIGN, body))).rejects.toMatchObject(forbidden);
    expect(mocks.bulkInsertChatMessages).not.toHaveBeenCalled();
  });

  test('a member may not file rows under another agent in their own session', async () => {
    const foreignRows = { messages: [{ role: 'user', content: 'x', agentId: 'personal-other' }] };
    await expect(POST(event(member, OWN, foreignRows))).rejects.toMatchObject(forbidden);
    expect(mocks.bulkInsertChatMessages).not.toHaveBeenCalled();
  });
});
