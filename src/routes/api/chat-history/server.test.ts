import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spec 117 D8: stored chat rows belong to the person whose assistant they are.
const mocks = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  getPersonalAssistantId: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: async () => ({ db: {}, tenantId: 'org-a' }),
}));
vi.mock('$server/services/chat.service', () => ({ listChatMessages: mocks.listChatMessages }));
vi.mock('$server/services/personal-agent.service', () => ({
  getPersonalAssistantId: mocks.getPersonalAssistantId,
}));

import { GET } from './+server';

const admin = { id: 'admin-1', role: 'admin', supabaseId: 'p-admin' };
const member = { id: 'u-1', role: 'user', supabaseId: 'p-1' };

function event(user: object, agentId: string) {
  return {
    locals: { user },
    url: new URL(`https://hub.test/api/chat-history?agentId=${agentId}`),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPersonalAssistantId.mockResolvedValue('personal-u-1');
  mocks.listChatMessages.mockResolvedValue([{ role: 'user', content: 'hola' }]);
});

describe('GET /api/chat-history', () => {
  test('a platform admin reads any agent', async () => {
    const res = await GET(event(admin, 'personal-other'));
    expect((await res.json()).messages).toHaveLength(1);
  });

  test('a member reads their own assistant, whatever the case', async () => {
    const res = await GET(event(member, 'Personal-U-1'));
    expect((await res.json()).messages).toHaveLength(1);
  });

  test('a member is refused another agent with the role message, not an empty list', async () => {
    await expect(GET(event(member, 'personal-other'))).rejects.toMatchObject({
      status: 403,
      body: { message: expect.stringMatching(/role cannot/i) },
    });
    expect(mocks.listChatMessages).not.toHaveBeenCalled();
  });
});
