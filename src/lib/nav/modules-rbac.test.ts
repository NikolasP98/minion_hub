import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { data: {}, url: new URL('http://localhost/') } }));

import { getModules, visibleModules } from '$lib/nav/modules';
import { canAccessRoute, routeAccessPolicyIdForPath } from '$lib/routes/route-access-policies';
import { apiWriteCapability } from '$server/services/rbac.service';

const ALL_ITEMS = getModules({ schedulingEnabled: true }).flatMap((mod) =>
  mod.items.map((it) => ({ module: mod.id, href: it.href })),
);

/**
 * Pages that are universal by design — see the "Deliberately NOT gated" note on
 * `requiredViewPermForPath` in $lib/permissions: personal preferences and the
 * landing pages everyone needs. Their org-config subroutes and write APIs gate
 * themselves. Anything else reaching the `authenticated` fallback is a hole.
 */
const UNIVERSAL = new Set(['/home', '/overview', '/settings']);

const ctx = (perms: string[]) => ({ authenticated: true, permissions: new Set(perms) });

describe('module registry ↔ RBAC', () => {
  it('gates every module page behind a permission or capability', () => {
    const ungated = ALL_ITEMS.filter(
      (it) => !UNIVERSAL.has(it.href) && routeAccessPolicyIdForPath(it.href) === 'authenticated',
    );
    expect(ungated).toEqual([]);
  });

  it('denies every gated page to a signed-in user with no permissions', () => {
    const visible = ALL_ITEMS.filter((it) => canAccessRoute(it.href, ctx([]))).map((it) => it.href);
    expect(visible.sort()).toEqual([...UNIVERSAL].sort());
  });

  it('shows a single-module role its module plus the universal pages only', () => {
    const mods = visibleModules({ schedulingEnabled: true }, (href) =>
      canAccessRoute(href, ctx(['stock:view'])),
    );
    // Organization/Platform survive because Home/Overview/Settings are
    // universal — module mode must never strand a user without a landing page
    // or their own settings. Every other page in them is filtered out.
    expect(mods.map((mod) => mod.id)).toEqual(['stock', 'organization', 'platform']);
    const byId = (id: string) => mods.find((mod) => mod.id === id)!.items.map((it) => it.href);
    expect(byId('stock').every((href) => href.startsWith('/stock'))).toBe(true);
    expect(byId('organization')).toEqual(['/home', '/overview']);
    expect(byId('platform')).toEqual(['/settings']);
  });

  it('keeps sub-resource pages out of a parent-only grant', () => {
    const posOnly = ctx(['pos:view']);
    // pos.sell / pos.items / pos.settings are their own RBAC rows.
    // /pos/sell is a write surface (it charges tickets), so `pos.sell:view`
    // alone — which a plain viewer role also holds — is not enough; it takes
    // the `pos:create` action override (route-access-registry.ts).
    expect(canAccessRoute('/pos/sell', posOnly)).toBe(false);
    expect(canAccessRoute('/pos/sell', ctx(['pos:view', 'pos.sell:view']))).toBe(false);
    expect(canAccessRoute('/pos/sell', ctx(['pos:view', 'pos.sell:view', 'pos:create']))).toBe(
      true,
    );
    // /pos/accounts (client credit, packages, instalment plans) is money + PII:
    // its own row, never implied by the module grant.
    expect(canAccessRoute('/pos/accounts', posOnly)).toBe(false);
    expect(canAccessRoute('/pos/accounts', ctx(['pos:view', 'pos.accounts:view']))).toBe(true);
    expect(canAccessRoute('/crm/insights', ctx(['crm:view']))).toBe(false);
    expect(canAccessRoute('/crm/customers', ctx(['crm:view']))).toBe(true);
  });

  it('blocks a viewer role from opening POS/stock write pages, only their read views', () => {
    // A `viewer` role gets `view` on every module + sub-resource and nothing
    // else (rbac.service defaultCaps) — so this is what capsToLegacyPermissions
    // actually emits for one, restricted to the modules under test.
    const viewer = ctx([
      'pos:view',
      'pos.sell:view',
      'pos.appointments:view',
      'pos.accounts:view',
      'pos.settings:view',
      'pos.items:view',
      'scheduling:view',
      'stock:view',
      'stock.entries:view',
    ]);
    expect(canAccessRoute('/pos/sell', viewer)).toBe(false);
    expect(canAccessRoute('/pos/settings', viewer)).toBe(false);
    expect(canAccessRoute('/pos/appointments/new', viewer)).toBe(false);
    expect(canAccessRoute('/stock/entries/new', viewer)).toBe(false);
    // The read-only pages the same role IS meant to see stay open.
    expect(canAccessRoute('/pos/appointments', viewer)).toBe(true);
    expect(canAccessRoute('/stock/entries', viewer)).toBe(true);

    // A `staff` role gets RWX (view+create+edit, no manage) on `pos` — enough
    // to sell, not enough to reconfigure the till.
    const staff = ctx(['pos:view', 'pos:create', 'pos:edit', 'pos.sell:view']);
    expect(canAccessRoute('/pos/sell', staff)).toBe(true);
    expect(canAccessRoute('/pos/settings', staff)).toBe(false);
  });

  it('routes every module write API to its own capability', () => {
    const expected: Array<[string, string]> = [
      ['/api/pos/tickets', 'pos'],
      // Every endpoint this spec's S2/S3/S5 slices added (packages, plans,
      // client accounts, booking series/notes) rides an existing module prefix.
      ['/api/pos/accounts/topup', 'pos'],
      ['/api/pos/packages/grants/g1', 'pos'],
      ['/api/pos/packages/grants/g1/redeem', 'pos'],
      ['/api/pos/plans', 'pos'],
      ['/api/pos/plans/p1', 'pos'],
      ['/api/pos/sellables/s1/components', 'pos'],
      ['/api/scheduling/bookings/series', 'scheduling'],
      ['/api/scheduling/bookings/b1/notes', 'scheduling'],
      ['/api/crm/contacts', 'crm'],
      ['/api/meta/campaigns', 'ads'],
      ['/api/scheduling/bookings', 'scheduling'],
      ['/api/stock/entries', 'stock'],
      ['/api/finances/invoices', 'finance'],
      ['/api/sales/orders', 'sales'],
      ['/api/memberships/plans', 'memberships'],
      ['/api/support/tickets', 'support'],
      ['/api/work/tasks', 'projects'],
      ['/api/workforce/issues', 'projects'],
      ['/api/pulse/entries', 'pulse'],
      ['/api/brains/x', 'brains'],
    ];
    for (const [path, module] of expected) {
      expect(apiWriteCapability(path, 'POST'), path).toMatchObject({ module });
    }
    // Anonymous booking stays capability-free, reads are never write-gated.
    expect(apiWriteCapability('/api/scheduling/public/slots', 'POST')).toBeNull();
    expect(apiWriteCapability('/api/crm/contacts', 'GET')).toBeNull();
    // A DELETE resolves to `delete`, not `edit` — cancelling a grant or a plan
    // must not ride an edit-only role.
    expect(apiWriteCapability('/api/pos/packages/grants/g1', 'DELETE')).toMatchObject({
      module: 'pos',
      action: 'delete',
    });
    expect(apiWriteCapability('/api/pos/plans/p1', 'DELETE')).toMatchObject({
      module: 'pos',
      action: 'delete',
    });
    // Opening a plan is `create`, which is what the UI gates its control on —
    // the two must not disagree or the button 403s for a create-less role.
    expect(apiWriteCapability('/api/pos/plans', 'POST')).toMatchObject({
      module: 'pos',
      action: 'create',
    });
  });

  /**
   * The client-account surfaces this spec added (stored-value balances, paid
   * session history, instalment plans) expose money and PII, not catalog, so
   * every one of their GET handlers carries its OWN `pos:view` check —
   * `apiWriteCapability` gates writes only, and a read left on bare
   * `getCoreCtx` + module-enabled would be an open door.
   *
   * Deliberately scoped to these three prefixes: `/api/pos/sellables` and
   * `/api/scheduling/bookings` are older catalog/appointment reads that gate on
   * module-enabled + PII masking, and are not this spec's to change.
   */
  it('gives every client-account read route an explicit pos:view gate', () => {
    const routes = import.meta.glob('/src/routes/api/pos/{accounts,packages,plans}/**/+server.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(routes).length).toBeGreaterThan(0);
    const ungatedReads = Object.entries(routes)
      .filter(([, src]) => /export const GET/.test(src))
      .filter(([, src]) => !/requireOrgCapability\(\s*locals,\s*'pos',\s*'view'/.test(src))
      .map(([path]) => path);
    expect(ungatedReads).toEqual([]);
  });
});
