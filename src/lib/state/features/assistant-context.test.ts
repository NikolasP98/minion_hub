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

// A full-permission user: `canViewPath` is what hides pages from the briefing,
// and an org owner sees all of them. Without this the size figures below would
// describe a user with almost no modules.
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));

const { buildAssistantContext } = await import('./assistant-context');
const { registerGlobalTools } = await import('$lib/assistant/global-tools');

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

describe('buildAssistantContext manifest gating (JEV turn router)', () => {
  beforeEach(() => {
    page.data = {};
  });

  function gated(path: string, loaded: string[]) {
    page.url = new URL(`https://hub${path}`);
    page.data = {};
    return buildAssistantContext(new Set(loaded as never));
  }

  test('the core is never gated: route, links, UI-tool protocol, closing line', () => {
    const ctx = gated('/crm/abc-123', []);
    expect(ctx).toContain('Current page: /crm/abc-123');
    expect(ctx).toContain('focused on customer id abc-123');
    expect(ctx).toContain('[label](/path)');
    expect(ctx).toContain("Keep replies tight. Don't restate this context.]");
  });

  test('the envelope keeps the markers chat-rpc strips it by', () => {
    const ctx = gated('/crm', []);
    expect(ctx.startsWith('[In-app assistant context')).toBe(true);
    expect(ctx.trimEnd().endsWith("Don't restate this context.]")).toBe(true);
  });

  test('a chat-mode turn drops the data and brain prose', () => {
    const ctx = gated('/crm', []);
    expect(ctx).not.toContain("You can read this org's live data");
    expect(ctx).not.toContain('call brains_list');
  });

  test('a data_question turn carries the data prose and nothing else optional', () => {
    const ctx = gated('/crm', ['data']);
    expect(ctx).toContain("You can read this org's live data");
    expect(ctx).not.toContain('call brains_list');
  });

  test('the changelog manifest tells the agent not to web-search other projects', () => {
    const ctx = gated('/crm', ['changelog']);
    expect(ctx).toContain('[the changelog](/changelog)');
    expect(ctx).toContain('Never web-search');
    expect(gated('/crm', [])).not.toContain('Never web-search');
  });

  test('no argument still builds the full envelope (unchanged default)', () => {
    const full = gated('/crm', ['pages', 'forms', 'data', 'brain', 'changelog']);
    page.url = new URL('https://hub/crm');
    page.data = {};
    const legacy = buildAssistantContext();
    expect(legacy).toBe(full);
  });

  // The whole point of the feature, end to end: a real admin's envelope with
  // the UI tools registered, per routed mode. Printed rather than pinned to an
  // exact number — these catalogs grow with the product — but the ratio the
  // feature promises IS asserted.
  test('reports the end-to-end envelope size per routed mode', () => {
    registerGlobalTools();
    const at = (loaded: string[]) => {
      page.url = new URL('https://hub/crm');
      page.data = {};
      return buildAssistantContext(new Set(loaded as never)).length;
    };
    // The loaded sets are the ones the live classifier actually produced for
    // these turns (recorded 2026-10-12); the sizes are what they cost.
    const sizes = {
      before_every_turn: at(['pages', 'forms', 'data', 'brain', 'changelog']),
      chat: at([]),
      navigate: at(['pages']),
      record_action: at(['forms']),
      data_question: at(['data', 'brain']),
      knowledge_question: at(['brain', 'changelog']),
    };
    console.info('[assistant envelope chars]', JSON.stringify(sizes));
    // Printed rather than pinned to exact numbers: the page and form catalogs
    // grow with the product. The promise of the feature is the ratio.
    expect(sizes.chat).toBeLessThan(sizes.before_every_turn * 0.35);
    expect(sizes.data_question).toBeLessThan(sizes.before_every_turn * 0.45);
    expect(sizes.knowledge_question).toBeLessThan(sizes.before_every_turn * 0.4);
    // A navigate turn still receives the full page list — the spec invariant.
    expect(sizes.navigate).toBeGreaterThan(sizes.before_every_turn * 0.7);
  });
});
