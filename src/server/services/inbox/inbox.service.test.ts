import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOrgCapabilityKeys: vi.fn(),
  selectResults: [] as unknown[][],
  insertValues: vi.fn(),
}));

/** Minimal chainable drizzle select stand-in — same pattern as
 *  custom-property-entities.service.test.ts. `then` lets `await`/destructure
 *  resolve the queued result for this call. */
function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'leftJoin', 'limit']) {
    c[method] = vi.fn(() => c);
  }
  c.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function makeTx() {
  let call = 0;
  return {
    select: vi.fn(() => chain(mocks.selectResults[call++] ?? [])),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        mocks.insertValues(v);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    })),
  };
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: vi.fn(async (_ctx: unknown, cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
    cb(makeTx()),
  ),
}));
vi.mock('$server/services/rbac.service', () => ({
  listOrgCapabilityKeys: mocks.listOrgCapabilityKeys,
}));

import { markRead } from './inbox.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const ctx = { tenantId: 'org-1', profileId: 'profile-1', db: {} } as CoreCtx;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOrgCapabilityKeys.mockResolvedValue([]);
});

describe('markRead', () => {
  it('marks every other unread row sharing the clicked href, same statement', async () => {
    mocks.selectResults = [
      [{ id: 'clicked-id', href: '/changelog' }], // clicked-row lookup
      [{ id: 'clicked-id' }, { id: 'other-id' }], // unread rows sharing that href
    ];

    const ids = await markRead(ctx, 'clicked-id');

    expect(ids).toEqual(['clicked-id', 'other-id']);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      { profileId: 'profile-1', notificationId: 'clicked-id', readAt: expect.any(Date) },
      { profileId: 'profile-1', notificationId: 'other-id', readAt: expect.any(Date) },
    ]);
  });

  it('falls back to just the clicked id when it has no href to fan out on', async () => {
    mocks.selectResults = [[{ id: 'clicked-id', href: null }], []];

    const ids = await markRead(ctx, 'clicked-id');

    expect(ids).toEqual(['clicked-id']);
  });

  it('throws 404 when the clicked row is not visible to this reader', async () => {
    mocks.selectResults = [[]];

    await expect(markRead(ctx, 'missing-id')).rejects.toMatchObject({ status: 404 });
  });
});
