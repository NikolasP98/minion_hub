import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mutable mock — buildAssistantContext reads page.url + page.data at call time,
// so reassigning these between calls exercises each route/focus branch.
const page = {
  url: new URL('https://hub/'),
  data: {} as Record<string, unknown>,
};
vi.mock('$app/state', () => ({
  get page() {
    return page;
  },
}));

const { buildAssistantContext } = await import('./assistant-context');

function at(path: string, data: Record<string, unknown> = {}) {
  page.url = new URL(`https://hub${path}`);
  page.data = data;
  return buildAssistantContext();
}

describe('buildAssistantContext', () => {
  beforeEach(() => {
    page.data = {};
  });

  test('describes the current route', () => {
    expect(at('/finances/invoices')).toContain('Current page: /finances/invoices');
    expect(at('/finances/invoices')).toContain('Invoices list');
  });

  test('longest-prefix wins (/crm/customers vs /crm/{id} vs /crm)', () => {
    expect(at('/crm/customers')).toContain('customers grid');
    expect(at('/crm/abc-123')).toContain("customer's CRM profile");
    expect(at('/crm')).toContain('CRM dashboard');
  });

  test('surfaces a focused customer id from the path', () => {
    const ctx = at('/crm/abc-123');
    expect(ctx).toContain('focused on customer id abc-123');
    expect(ctx).toContain('/crm/abc-123');
  });

  test('surfaces ?contact= filter as a linkable focus', () => {
    const ctx = at('/finances/invoices?contact=p-9');
    expect(ctx).toContain('filtered to customer id p-9');
    expect(ctx).toContain('/crm/p-9');
  });

  test('includes the active org name when resolvable', () => {
    const ctx = at('/crm', {
      organizations: [
        { id: 'o1', name: 'FACES' },
        { id: 'o2', name: 'MINION' },
      ],
      activeOrgId: 'o2',
    });
    expect(ctx).toContain('for MINION');
  });

  test('multi-org user gets a machine-readable active_org_id for data tools', () => {
    const ctx = at('/crm', {
      organizations: [
        { id: 'o1', name: 'FACES' },
        { id: 'o2', name: 'MINION' },
      ],
      activeOrgId: 'o2',
    });
    expect(ctx).toContain('active_org_id: o2');
  });

  test('single-org user gets NO active_org_id line (endpoint defaults)', () => {
    const ctx = at('/crm', {
      organizations: [{ id: 'o1', name: 'FACES' }],
      activeOrgId: 'o1',
    });
    expect(ctx).toContain('for FACES');
    expect(ctx).not.toContain('active_org_id');
  });

  test('routes organization knowledge through the active org Master Brain', () => {
    const ctx = at('/home', {
      organizations: [
        { id: 'o1', name: 'FACES' },
        { id: 'o2', name: 'MINION' },
      ],
      activeOrgId: 'o2',
    });
    expect(ctx).toContain('call brains_list with the active orgId');
    expect(ctx).toContain("select that organization's Master Brain");
    expect(ctx).toContain('Never guess or reuse a brainId from another organization');
  });

  test('always teaches the in-app-link navigation convention', () => {
    const ctx = at('/');
    expect(ctx).toContain('[label](/path)');
    expect(ctx).toContain('click is the user');
  });

  test('no focus clause when nothing is focused', () => {
    const ctx = at('/sessions');
    expect(ctx).not.toContain('Focus:');
  });
});
