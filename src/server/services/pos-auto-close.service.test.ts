import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const closeShiftMock = vi.fn();
vi.mock('./pos.service', () => ({ closeShift: (...a: unknown[]) => closeShiftMock(...a) }));
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));

import { autoCloseOrgShifts } from './pos-auto-close.service';

beforeEach(() => {
  closeShiftMock.mockReset();
  closeShiftMock.mockResolvedValue({});
});

describe('autoCloseOrgShifts (spec 148)', () => {
  it('closes each pre-midnight shift through closeShift with counted = expected', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 's1', openedBy: 'u1' },
        { id: 's2', openedBy: 'u2' },
      ],
    ]);
    const r = await autoCloseOrgShifts(
      { db: db as never, tenantId: 'org-1' },
      new Date('2026-11-25T05:00:00Z'),
    );
    expect(r).toEqual({ closed: 2, failed: 0 });
    expect(closeShiftMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shiftId: 's1',
        countedFromExpected: true,
        note: 'Cierre automático',
        actor: { id: 'u1', name: 'cierre-automatico' },
      }),
    );
  });

  it('is a no-op when nothing is left open (a re-run), and one failure does not stop the rest', async () => {
    const empty = createMockDb();
    empty.resolveSequence([[]]);
    expect(
      await autoCloseOrgShifts({ db: empty.db as never, tenantId: 'org-1' }, new Date()),
    ).toEqual({
      closed: 0,
      failed: 0,
    });

    const two = createMockDb();
    two.resolveSequence([
      [
        { id: 'a', openedBy: null },
        { id: 'b', openedBy: 'u' },
      ],
    ]);
    closeShiftMock.mockRejectedValueOnce(new Error('lock timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await autoCloseOrgShifts({ db: two.db as never, tenantId: 'org-1' }, new Date()),
    ).toEqual({
      closed: 1,
      failed: 1,
    });
  });
});
