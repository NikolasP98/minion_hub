import { describe, it, expect } from 'vitest';
import { availableTransitions, isStatusChangeAllowed, isWfDocType, type Transition } from './workflow.service';

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

describe('isStatusChangeAllowed (direct-PATCH guard)', () => {
  it('allows a no-op (same status)', () => {
    expect(isStatusChangeAllowed(T, 'open', 'open', { role: 'user', id: 'u1' }, null)).toBe(true);
  });
  it('allows a change that matches a reachable transition target', () => {
    expect(isStatusChangeAllowed(T, 'open', 'replied', { role: 'user', id: 'u1' }, null)).toBe(true);
  });
  it('blocks a jump that no transition permits', () => {
    expect(isStatusChangeAllowed(T, 'open', 'resolved', { role: 'user', id: 'u1' }, null)).toBe(false);
  });
  it('respects role-gating (user blocked, admin allowed)', () => {
    expect(isStatusChangeAllowed(T, 'replied', 'resolved', { role: 'user', id: 'u1' }, null)).toBe(false);
    expect(isStatusChangeAllowed(T, 'replied', 'resolved', { role: 'admin', id: 'a1' }, null)).toBe(true);
  });
  it('respects self-approval guard on direct edits', () => {
    expect(isStatusChangeAllowed(T, 'replied', 'approved', { role: 'user', id: 'u1' }, 'u1')).toBe(false);
    expect(isStatusChangeAllowed(T, 'replied', 'approved', { role: 'user', id: 'u2' }, 'u1')).toBe(true);
  });
});

describe('isWfDocType', () => {
  it('allowlists status-bearing docs only', () => {
    expect(isWfDocType('support_issue')).toBe(true);
    expect(isWfDocType('crm_contact')).toBe(false);
  });
});
