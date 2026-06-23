import { describe, it, expect } from 'vitest';
import { pickAssignee, isDocTypeAllowed } from './assignment.service';

describe('pickAssignee', () => {
  const team = ['a', 'b', 'c'];

  it('round-robin walks the list and advances the cursor', () => {
    expect(pickAssignee('round_robin', team, 0, {})).toEqual({ assigneeId: 'a', nextCursor: 1 });
    expect(pickAssignee('round_robin', team, 1, {})).toEqual({ assigneeId: 'b', nextCursor: 2 });
    expect(pickAssignee('round_robin', team, 3, {})).toEqual({ assigneeId: 'a', nextCursor: 4 }); // wraps
  });

  it('least-open picks the fewest, ties → earliest, cursor unchanged', () => {
    expect(pickAssignee('least_open', team, 5, { a: 4, b: 1, c: 9 })).toEqual({ assigneeId: 'b', nextCursor: 5 });
    expect(pickAssignee('least_open', team, 5, { a: 2, b: 2, c: 2 })).toEqual({ assigneeId: 'a', nextCursor: 5 });
    expect(pickAssignee('least_open', team, 5, {})).toEqual({ assigneeId: 'a', nextCursor: 5 }); // all zero
  });

  it('empty team → no assignee', () => {
    expect(pickAssignee('round_robin', [], 0, {})).toEqual({ assigneeId: null, nextCursor: 0 });
  });
});

describe('isDocTypeAllowed', () => {
  it('allowlists the three doc types only', () => {
    expect(isDocTypeAllowed('support_issue')).toBe(true);
    expect(isDocTypeAllowed('crm_contact')).toBe(true);
    expect(isDocTypeAllowed('users; drop table x')).toBe(false);
  });
});
