import { describe, it, expect } from 'vitest';
import { availableTransitions, isWfDocType, type Transition } from './workflow.service';

const T: Transition[] = [
  { action: 'Reply', from: 'open', to: 'replied' },
  { action: 'Resolve', from: 'replied', to: 'resolved', role: 'admin' },
  { action: 'Approve', from: 'replied', to: 'approved', allowSelfApprove: false },
];

describe('availableTransitions', () => {
  it('filters by current state', () => {
    expect(availableTransitions(T, 'open', { role: 'user', id: 'u1' }, null).map((t) => t.action)).toEqual(['Reply']);
  });
  it('role-gates (admin bypasses)', () => {
    expect(availableTransitions(T, 'replied', { role: 'user', id: 'u1' }, null).map((t) => t.action)).toEqual(['Approve']);
    expect(availableTransitions(T, 'replied', { role: 'admin', id: 'a1' }, null).map((t) => t.action)).toEqual(['Resolve', 'Approve']);
  });
  it('self-approval guard blocks the owner (but not admin)', () => {
    expect(availableTransitions(T, 'replied', { role: 'user', id: 'u1' }, 'u1').map((t) => t.action)).toEqual([]);
    expect(availableTransitions(T, 'replied', { role: 'user', id: 'u2' }, 'u1').map((t) => t.action)).toEqual(['Approve']);
    expect(availableTransitions(T, 'replied', { role: 'admin', id: 'u1' }, 'u1').map((t) => t.action)).toEqual(['Resolve', 'Approve']);
  });
});

describe('isWfDocType', () => {
  it('allowlists status-bearing docs only', () => {
    expect(isWfDocType('support_issue')).toBe(true);
    expect(isWfDocType('crm_contact')).toBe(false);
  });
});
