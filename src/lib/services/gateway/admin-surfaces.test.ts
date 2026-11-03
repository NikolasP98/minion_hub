/**
 * Spec 045 T038: surfaces behind a PLATFORM_ADMIN_ONLY method are not rendered
 * for anyone but a platform admin once the dashboard connects with per-user
 * passes — and are untouched while the flag is unset.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';
import { adminOnlyUrlHidden, canViewPath } from '$lib/access/can.svelte';
import { utilityLinks } from '$lib/components/layout/utility-links';
import { adminOnlyPageHidden } from './platform-admin-methods';

const nav = vi.hoisted(() => ({
  config: { sections: [] as unknown[], builtinSections: {} as Record<string, unknown[]> },
}));
vi.mock('$lib/nav/nav-config.svelte', () => ({ navConfig: () => nav.config }));

const AS_MEMBER = { user: { role: 'user' }, permissions: { permissions: ['reliability:view', 'workspace:view'] } };
const AS_ADMIN = { user: { role: 'admin' }, permissions: AS_MEMBER.permissions };

function setup(flag: 'false' | undefined, data: Record<string, unknown>) {
  if (flag) publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = flag;
  else delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = data;
}

afterEach(() => {
  delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
  page.data = {};
});

const ADMIN_PAGES = [
  '/reliability',
  '/killswitches',
  '/cloud',
  '/cloud/terminal',
  '/shells/abc',
  '/flow-editor',
  '/config',
  '/prompt',
  '/plugins/some-plugin',
  '/channels/whatsapp-crm',
  '/sessions/agent%3Aa%3Amain/debug',
  '/agents/workshop/compare',
  '/agents/workshop/groupchat',
];

describe('admin-only pages (nav entry + URL)', () => {
  it.each(ADMIN_PAGES)('%s is hidden from a member after the switch', (path) => {
    setup('false', AS_MEMBER);
    expect(adminOnlyPageHidden(path)).toBe(true);
    expect(canViewPath(path)).toBe(false);
  });

  it.each(ADMIN_PAGES)('%s stays for a platform admin after the switch', (path) => {
    setup('false', AS_ADMIN);
    expect(adminOnlyPageHidden(path)).toBe(false);
  });

  it.each(ADMIN_PAGES)('%s is untouched while the flag is unset', (path) => {
    setup(undefined, AS_MEMBER);
    expect(adminOnlyPageHidden(path)).toBe(false);
  });

  it('member pages next to them are never hidden', () => {
    setup('false', AS_MEMBER);
    for (const p of [
      '/agents',
      '/agents/workshop',
      '/tools',
      '/tools/t1',
      '/flow-editor/skills/s1',
      '/flow-editor/master/m1',
      '/channels/gmail',
      '/sessions',
      '/plugins',
      '/workforce/reliability',
    ]) {
      expect(adminOnlyPageHidden(p)).toBe(false);
    }
  });

  it('the utility links (topbar + sidebar) drop the cloud entry for a member, only after the switch', () => {
    setup(undefined, AS_MEMBER);
    expect(utilityLinks(canViewPath).map((l) => l.href)).toContain('/cloud');
    setup('false', AS_MEMBER);
    const offered = utilityLinks(canViewPath).map((l) => l.href);
    expect(offered).not.toContain('/reliability');
    expect(offered).not.toContain('/cloud');
    expect(offered).not.toContain('/killswitches');
    setup('false', AS_ADMIN);
    expect(utilityLinks(canViewPath).map((l) => l.href)).toContain('/cloud');
  });

  it('a custom nav entry is judged by the page it renders (spec 037 alias to /reliability)', () => {
    nav.config = {
      sections: [{ slug: 'ops', id: 's1', pages: [{ id: 'abc123', slug: 'rel', target: '/reliability' }] }],
      builtinSections: {},
    };
    try {
      setup('false', AS_MEMBER);
      expect(adminOnlyUrlHidden('/ops/rel~abc123')).toBe(true);
      expect(canViewPath('/ops/rel~abc123')).toBe(false);
      expect(adminOnlyUrlHidden('/en/ops/rel~abc123')).toBe(true);
      setup('false', AS_ADMIN);
      expect(adminOnlyUrlHidden('/ops/rel~abc123')).toBe(false);
      setup(undefined, AS_MEMBER);
      expect(adminOnlyUrlHidden('/ops/rel~abc123')).toBe(false);
    } finally {
      nav.config = { sections: [], builtinSections: {} };
    }
  });
});
