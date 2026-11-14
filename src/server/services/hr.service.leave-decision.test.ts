import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { decideLeaveRequest, HrRuleError } from './hr.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1', profileId: 'manager-1' });
const pending = { req: { id: 'lr-1', status: 'pending' }, profileId: 'employee-1' };

describe('decideLeaveRequest: compare-and-set on the status it read', () => {
  it('a decision whose request changed status meanwhile is refused with bad_transition', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [pending], // read: still pending when checked
      [], // compare-and-set update: another decision won, no row matched
    ]);

    const err = await decideLeaveRequest(ctx(db), 'lr-1', 'approved').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HrRuleError);
    expect((err as HrRuleError).code).toBe('bad_transition');
  });

  it('a fresh decision returns the updated row', async () => {
    const { db, resolveSequence } = createMockDb();
    const updated = { id: 'lr-1', status: 'approved', decidedBy: 'manager-1' };
    resolveSequence([[pending], [updated]]);

    await expect(decideLeaveRequest(ctx(db), 'lr-1', 'approved')).resolves.toEqual(updated);
  });
});
