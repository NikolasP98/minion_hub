import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  userOwnsGroup: vi.fn(),
  setGroupMembers: vi.fn(),
  addAgentToGroup: vi.fn(),
  removeAgentFromGroup: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/agent-group.service', () => ({
  userOwnsGroup: mocks.userOwnsGroup,
  setGroupMembers: mocks.setGroupMembers,
  addAgentToGroup: mocks.addAgentToGroup,
  removeAgentFromGroup: mocks.removeAgentFromGroup,
}));

import { DELETE, POST, PUT } from './+server';

const ctx = { tenantId: 'org-1' };
function call(handler: typeof POST, body: unknown) {
  return handler({
    locals: { user: { supabaseId: 'profile-1' } },
    params: { id: 'srv', groupId: 'grp-1' },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(ctx);
});

describe.each([
  ['POST', POST, 'addAgentToGroup', { agentId: 'a1' }],
  ['DELETE', DELETE, 'removeAgentFromGroup', { agentId: 'a1' }],
  ['PUT', PUT, 'setGroupMembers', { agentIds: ['a1'] }],
] as const)('%s members', (_n, handler, writer, body) => {
  test('owner can write', async () => {
    mocks.userOwnsGroup.mockResolvedValue(true);
    await call(handler as typeof POST, body);
    expect(mocks.userOwnsGroup).toHaveBeenCalledWith(ctx, 'profile-1', 'grp-1');
    expect(mocks[writer]).toHaveBeenCalled();
  });

  test('another member of the org gets 404 and nothing is written', async () => {
    mocks.userOwnsGroup.mockResolvedValue(false);
    await expect(call(handler as typeof POST, body)).rejects.toMatchObject({ status: 404 });
    expect(mocks[writer]).not.toHaveBeenCalled();
  });
});
