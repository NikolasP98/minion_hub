import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spec 117 D8: a group-chat run records its creator (`user_id`); a member reads only their own.
const mocks = vi.hoisted(() => ({ getGroupchatRun: vi.fn() }));

vi.mock('$server/services/entitlements.service', () => ({ requireFeature: async () => {} }));
vi.mock('$server/services/groupchat.service', () => ({ getGroupchatRun: mocks.getGroupchatRun }));

import { GET } from './+server';

const admin = { id: 'admin-1', role: 'admin', supabaseId: 'p-admin' };
const member = { id: 'u-1', role: 'user', supabaseId: 'p-1' };
const runBy = (userId: string | null) => ({ run: { id: 'r1', userId }, agents: [], messages: [] });
const event = (user: object) =>
  ({ locals: { user, tenantCtx: { tenantId: 'org-a' } }, params: { id: 'r1' } }) as never;
const forbidden = { status: 403, body: { message: expect.stringMatching(/role cannot/i) } };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/workshop/groupchat/[id]', () => {
  test('a platform admin reads any run', async () => {
    mocks.getGroupchatRun.mockResolvedValue(runBy('u-2'));
    expect((await (await GET(event(admin))).json()).run.id).toBe('r1');
  });

  test('a member reads a run they created', async () => {
    mocks.getGroupchatRun.mockResolvedValue(runBy('u-1'));
    expect((await (await GET(event(member))).json()).run.id).toBe('r1');
  });

  test.each(['u-2', null])('a member is refused a run created by %s', async (creator) => {
    mocks.getGroupchatRun.mockResolvedValue(runBy(creator));
    await expect(GET(event(member))).rejects.toMatchObject(forbidden);
  });

  test('an unknown run is still 404', async () => {
    mocks.getGroupchatRun.mockResolvedValue(null);
    await expect(GET(event(member))).rejects.toMatchObject({ status: 404 });
  });
});
