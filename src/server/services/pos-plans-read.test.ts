import { describe, expect, it } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { listPlans } from './pos-accounts.service';

describe('plan collection advisory schedule classification', () => {
  it.each([
    { dueSchedule: null, scheduleIssue: null },
    { dueSchedule: [{ dueOn: '2026-02-30', amount: 100 }], scheduleIssue: 'invalid_rows' },
    { dueSchedule: [{ dueOn: '2026-10-03', amount: 50 }], scheduleIssue: 'principal_mismatch' },
    { dueSchedule: [{ dueOn: '2026-10-03', amount: 100 }], scheduleIssue: null },
  ])(
    'flags $scheduleIssue without hiding the legacy agreement',
    async ({ dueSchedule, scheduleIssue }) => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [{ id: 'p1', orgId: 'org1', currency: 'PEN', totalAmount: '100.00', dueSchedule }],
      ]);
      const rows = await listPlans({ db: db as never, tenantId: 'org1' });
      expect(rows).toEqual([
        expect.objectContaining({ id: 'p1', totalAmount: '100.00', dueSchedule, scheduleIssue }),
      ]);
      expect(db.update).not.toHaveBeenCalled();
    },
  );
});
