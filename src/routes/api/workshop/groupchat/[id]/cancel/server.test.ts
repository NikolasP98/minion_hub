import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spec 117 FR-010: a member stops only a group-chat run they created.
const mocks = vi.hoisted(() => ({
  getGroupchatRun: vi.fn(),
  setRunStatus: vi.fn(),
  cancelJobsByRef: vi.fn(),
}));

vi.mock('$server/services/entitlements.service', () => ({ requireFeature: async () => {} }));
vi.mock('$server/services/bg-runtime', () => ({ cancelJobsByRef: mocks.cancelJobsByRef }));
vi.mock('$server/services/groupchat.service', () => ({
  getGroupchatRun: mocks.getGroupchatRun,
  setRunStatus: mocks.setRunStatus,
}));

import { POST } from './+server';

const event = (user: object) =>
  ({ locals: { user, tenantCtx: { tenantId: 'org-a' } }, params: { id: 'r1' } }) as never;

beforeEach(() => vi.clearAllMocks());

describe('POST /api/workshop/groupchat/[id]/cancel', () => {
  test('a member is refused a run someone else created and nothing is cancelled', async () => {
    mocks.getGroupchatRun.mockResolvedValue({ run: { id: 'r1', userId: 'u-2' } });
    await expect(POST(event({ id: 'u-1', role: 'user' }))).rejects.toMatchObject({ status: 403 });
    expect(mocks.cancelJobsByRef).not.toHaveBeenCalled();
    expect(mocks.setRunStatus).not.toHaveBeenCalled();
  });

  test('a member stops their own run', async () => {
    mocks.getGroupchatRun.mockResolvedValue({ run: { id: 'r1', userId: 'u-1' } });
    expect((await POST(event({ id: 'u-1', role: 'user' }))).status).toBe(200);
    expect(mocks.setRunStatus).toHaveBeenCalledWith('r1', 'cancelled');
  });
});
