import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBooking: vi.fn(),
  bumpDoorStat: vi.fn(),
}));

vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: 'link-1',
            orgId: 'org',
            slug: 's',
            title: 't',
            description: null,
            eventTypeIds: ['et-1'],
            resourceId: null,
            active: true,
            expiresAt: null,
          },
        ],
      }),
    }),
  }),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_c: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({ from: () => ({ where: async () => [{ id: 'et-1' }] }) }),
    }),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('./scheduling-slots.service', () => ({ getSlotsForEventType: vi.fn() }));
vi.mock('./scheduling-bookings.service', () => ({ createBooking: mocks.createBooking }));
vi.mock('./doors.service', () => ({ bumpDoorStat: mocks.bumpDoorStat }));

import { publicBook } from './scheduling-public.service';

const base = { eventTypeId: 'et-1', start: '2026-01-01T10:00:00.000Z', name: 'Ana' };

describe('publicBook attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBooking.mockResolvedValue({ uid: 'u' });
  });

  it('stores attribution on the booking, passes it as firstTouch, pins the door to the link, counts a submission', async () => {
    await publicBook('s', {
      ...base,
      attribution: {
        door: 'book:someone-elses-link',
        utm_source: 'instagram',
        at: '2026-10-25T10:00:00.000Z',
      },
    });
    const arg = mocks.createBooking.mock.calls[0][1];
    expect(arg.metadata.attribution).toMatchObject({
      door: 'book:link-1',
      utm_source: 'instagram',
    });
    expect(arg.firstTouch).toBe(arg.metadata.attribution);
    expect(mocks.bumpDoorStat).toHaveBeenCalledWith(
      expect.anything(),
      'book:link-1',
      'submissions',
    );
  });

  it('books with no metadata or firstTouch when no attribution is sent', async () => {
    await publicBook('s', base);
    const arg = mocks.createBooking.mock.calls[0][1];
    expect(arg.metadata).toBeUndefined();
    expect(arg.firstTouch).toBeUndefined();
    expect(mocks.bumpDoorStat).toHaveBeenCalledOnce();
  });

  it('does not count a submission when the booking throws', async () => {
    mocks.createBooking.mockRejectedValue(new Error('slot'));
    await expect(publicBook('s', base)).rejects.toThrow();
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
  });
});
