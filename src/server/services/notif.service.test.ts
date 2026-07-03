import { describe, it, expect } from 'vitest';
import { evaluateCondition, renderTemplate, isTriggerTableAllowed, registerNotifCandidateSource, type Filter } from './notif.service';

describe('evaluateCondition', () => {
  const row = { status: 'open', priority: 'urgent', n: 5 };
  it('AND-matches eq/neq/gt', () => {
    expect(evaluateCondition([{ field: 'status', op: 'eq', value: 'open' }] as Filter[], row)).toBe(true);
    expect(evaluateCondition([{ field: 'status', op: 'neq', value: 'open' }] as Filter[], row)).toBe(false);
    expect(evaluateCondition([{ field: 'n', op: 'gt', value: 3 }] as Filter[], row)).toBe(true);
  });
  it('empty filter always matches', () => {
    expect(evaluateCondition([], row)).toBe(true);
  });
  it('all filters must pass', () => {
    expect(
      evaluateCondition(
        [{ field: 'status', op: 'eq', value: 'open' }, { field: 'priority', op: 'eq', value: 'low' }] as Filter[],
        row,
      ),
    ).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('interpolates {{field}} and blanks missing', () => {
    expect(renderTemplate('Hi {{name}} — {{status}}', { name: 'Ana', status: 'open' })).toBe('Hi Ana — open');
    expect(renderTemplate('{{missing}}!', {})).toBe('!');
  });
});

describe('isTriggerTableAllowed', () => {
  it('allowlists known tables only', () => {
    expect(isTriggerTableAllowed('support_issues')).toBe(true);
    expect(isTriggerTableAllowed('users; drop table x')).toBe(false);
  });
});

describe('registerNotifCandidateSource', () => {
  it('allowlists a registered candidate-source key (e.g. stock.service registering stk_reorder)', () => {
    expect(isTriggerTableAllowed('__test_source__')).toBe(false);
    registerNotifCandidateSource('__test_source__', async () => []);
    expect(isTriggerTableAllowed('__test_source__')).toBe(true);
  });
});
