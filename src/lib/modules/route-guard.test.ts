import { describe, test, expect } from 'vitest';
import { canonicalPath } from '$lib/canonical-path';
import {
  isAppPageRequest,
  isAppRouteBlocked,
  shouldApplyOrganizationRouteGuards,
} from './route-guard';

describe('isAppPageRequest — request-class classification', () => {
  test('authenticated (app) page request is in-class', () => {
    expect(isAppPageRequest(true, '/(app)/pos/sell')).toBe(true);
  });

  test('server-token request (no locals.user) is skipped even on an (app)-shaped route id', () => {
    // Mirrors resolve-identity.ts: the server-token provider sets
    // bypassGate:true and never reaches finishApp at all, but this
    // classification is defense in depth for anything that does.
    expect(isAppPageRequest(false, '/(app)/pos/sell')).toBe(false);
  });

  test('API routes (no (app) route id) are skipped', () => {
    expect(isAppPageRequest(true, '/api/pos/sellables')).toBe(false);
  });

  test('a null/undefined route id (unmatched route) is skipped', () => {
    expect(isAppPageRequest(true, null)).toBe(false);
    expect(isAppPageRequest(true, undefined)).toBe(false);
  });
});

describe('shouldApplyOrganizationRouteGuards — organization recovery boundary', () => {
  test('defers organization-scoped guards until recovery supplies tenant context', () => {
    expect(shouldApplyOrganizationRouteGuards(true, false, '/(app)/home')).toBe(false);
  });

  test('runs for an authenticated organization-scoped app request', () => {
    expect(shouldApplyOrganizationRouteGuards(true, true, '/(app)/home')).toBe(true);
  });
});

describe('isAppRouteBlocked — locale + longest-prefix composition (R6: canonicalization stays separate)', () => {
  test('locale-prefixed path resolves the same as its canonical form', () => {
    const ctx = { kind: 'business' as const, moduleStates: {} };
    expect(isAppRouteBlocked(canonicalPath('/es/pulse'), ctx)).toBe(true);
    expect(isAppRouteBlocked(canonicalPath('/en/pos/sell'), ctx)).toBe(false);
  });

  test('/settings/pulse (localized) still resolves to pulse via longest-prefix, not a bare /settings', () => {
    const business = { kind: 'business' as const, moduleStates: {} };
    const personal = { kind: 'personal' as const, moduleStates: {} };
    // blocked for both kinds only because it resolves to pulse; a bare /settings stays open
    expect(isAppRouteBlocked(canonicalPath('/es/settings/pulse'), business)).toBe(true);
    expect(isAppRouteBlocked(canonicalPath('/es/settings/pulse'), personal)).toBe(true);
    expect(isAppRouteBlocked(canonicalPath('/es/settings'), personal)).toBe(false);
    expect(isAppRouteBlocked(canonicalPath('/es/settings'), business)).toBe(false);
  });
});

describe('isAppRouteBlocked — org-kind restrictions', () => {
  test('personal org: /pos, /stock, /workforce all 404', () => {
    const ctx = { kind: 'personal' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/pos/sell', ctx)).toBe(true);
    expect(isAppRouteBlocked('/stock/items', ctx)).toBe(true);
    expect(isAppRouteBlocked('/workforce/projects', ctx)).toBe(true);
  });

  test('business org: /pos, /stock, /workforce pass', () => {
    const ctx = { kind: 'business' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/pos/sell', ctx)).toBe(false);
    expect(isAppRouteBlocked('/stock/items', ctx)).toBe(false);
    expect(isAppRouteBlocked('/workforce/projects', ctx)).toBe(false);
  });

  test('business org: /pulse and /settings/pulse 404', () => {
    const ctx = { kind: 'business' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/pulse', ctx)).toBe(true);
    expect(isAppRouteBlocked('/settings/pulse', ctx)).toBe(true);
  });

  test('personal org: /pulse and /settings/pulse 404 too (Pulse switched off for every org)', () => {
    const ctx = { kind: 'personal' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/pulse', ctx)).toBe(true);
    expect(isAppRouteBlocked('/settings/pulse', ctx)).toBe(true);
  });

  // S3/WP1 (specs/2026-07-22-personal-org-differentiation-spec.md R1): DELIBERATE
  // expansion — personal orgs additionally lose support/memberships/sales/ads/team.
  test('personal org: /support, /sales, /memberships, /team, /socials all 404', () => {
    const ctx = { kind: 'personal' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/support', ctx)).toBe(true);
    expect(isAppRouteBlocked('/sales', ctx)).toBe(true);
    expect(isAppRouteBlocked('/memberships', ctx)).toBe(true);
    expect(isAppRouteBlocked('/team', ctx)).toBe(true);
    expect(isAppRouteBlocked('/socials', ctx)).toBe(true);
    expect(isAppRouteBlocked('/settings/team', ctx)).toBe(true);
  });

  test('business org: /support, /sales, /memberships, /team, /socials all pass', () => {
    const ctx = { kind: 'business' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/support', ctx)).toBe(false);
    expect(isAppRouteBlocked('/sales', ctx)).toBe(false);
    expect(isAppRouteBlocked('/memberships', ctx)).toBe(false);
    expect(isAppRouteBlocked('/team', ctx)).toBe(false);
    expect(isAppRouteBlocked('/socials', ctx)).toBe(false);
    expect(isAppRouteBlocked('/settings/team', ctx)).toBe(false);
  });
});

describe('isAppRouteBlocked — module-toggle state', () => {
  test('toggled-off mapped module 404s', () => {
    expect(
      isAppRouteBlocked('/finances', { kind: 'business', moduleStates: { finances: false } }),
    ).toBe(true);
  });

  test('missing toggle row (absent = enabled) passes', () => {
    expect(isAppRouteBlocked('/finances', { kind: 'business', moduleStates: {} })).toBe(false);
  });

  test('composite /pos/appointments 404s when either dependency is toggled off', () => {
    expect(
      isAppRouteBlocked('/pos/appointments', {
        kind: 'business',
        moduleStates: { scheduling: false },
      }),
    ).toBe(true);
  });
});

describe('isAppRouteBlocked — unmapped paths', () => {
  test('a path with no manifest entry always passes', () => {
    const ctx = { kind: undefined, moduleStates: {} };
    expect(isAppRouteBlocked('/home', ctx)).toBe(false);
    expect(isAppRouteBlocked('/crm', ctx)).toBe(false);
    // /settings/team is no longer unmapped as of S3/WP1 — see the
    // "unknown kind fails CLOSED" describe block below for its coverage.
  });
});

describe('isAppRouteBlocked — unknown kind fails CLOSED (overrides isModuleAvailable UI business-fallback)', () => {
  test('unresolved kind 404s a business-only module (pos), NOT defaults to allowed', () => {
    expect(isAppRouteBlocked('/pos/sell', { kind: undefined, moduleStates: {} })).toBe(true);
    expect(isAppRouteBlocked('/stock/items', { kind: null, moduleStates: {} })).toBe(true);
  });

  test('unresolved kind 404s a personal-only module (pulse) too', () => {
    expect(isAppRouteBlocked('/pulse', { kind: undefined, moduleStates: {} })).toBe(true);
  });

  test('unresolved kind 404s the new business-only /team and /settings/team (S3/WP1)', () => {
    expect(isAppRouteBlocked('/team', { kind: undefined, moduleStates: {} })).toBe(true);
    expect(isAppRouteBlocked('/settings/team', { kind: undefined, moduleStates: {} })).toBe(true);
  });

  test('unresolved kind 404s a composite whose dependency is kind-restricted (posAppointments -> pos)', () => {
    expect(isAppRouteBlocked('/pos/appointments', { kind: undefined, moduleStates: {} })).toBe(
      true,
    );
  });

  test('unresolved kind still passes a module with no kind restriction at all', () => {
    expect(isAppRouteBlocked('/finances', { kind: undefined, moduleStates: {} })).toBe(false);
    expect(isAppRouteBlocked('/crm', { kind: null, moduleStates: {} })).toBe(false);
  });
});

describe('isAppRouteBlocked — plan features (spec 043)', () => {
  const AI_PREFIXES = [
    '/agents',
    '/builder',
    '/workshop',
    '/sessions',
    '/brains',
    '/prompt',
    '/capabilities',
    '/tools',
    '/flow-editor/skills',
    '/workforce',
    '/reliability',
    '/plugins',
    '/settings/plugins',
    '/marketplace',
  ];
  const premium = ['ai', 'ai.chat', 'ai.proactive', 'marketplace'];
  test.each(AI_PREFIXES)('%s: blocked for Base, open for Premium', (path) => {
    expect(isAppRouteBlocked(path, { kind: 'personal', moduleStates: {}, features: [] })).toBe(
      true,
    );
    expect(
      isAppRouteBlocked(`${path}/x`, { kind: 'business', moduleStates: {}, features: [] }),
    ).toBe(true);
    // personal kind so the route is kind-available; /workforce is business-only, so check it with business.
    const kind = path === '/workforce' ? 'business' : 'personal';
    expect(isAppRouteBlocked(path, { kind, moduleStates: {}, features: premium })).toBe(false);
  });
  // Pulse is the only ai.proactive route and is switched off for every kind, so it is blocked
  // even on Premium; the plan-feature branch for these paths becomes observable again when Pulse
  // returns. Plan-feature logic itself stays covered by the AI_PREFIXES test.each above.
  test.each(['/pulse', '/settings/pulse'])(
    '%s: blocked on every plan while Pulse is off',
    (path) => {
      for (const features of [[], premium])
        for (const kind of ['personal', 'business'] as const)
          expect(isAppRouteBlocked(path, { kind, moduleStates: {}, features })).toBe(true);
    },
  );
  test('Base keeps channels, settings, the flow editor and business modules', () => {
    const base = { kind: 'business' as const, moduleStates: {}, features: [] };
    for (const p of [
      '/channels',
      '/channels/gmail',
      '/settings',
      '/flow-editor',
      '/crm',
      '/pos',
      '/home',
    ])
      expect(isAppRouteBlocked(p, base), p).toBe(false);
  });
  test('no features in the context = not checked (callers before spec 043)', () => {
    expect(isAppRouteBlocked('/agents', { kind: 'business', moduleStates: {} })).toBe(false);
  });
  test('locale-prefixed AI URL 404s once canonicalized', () => {
    expect(
      isAppRouteBlocked(canonicalPath('/es/marketplace'), {
        kind: 'business',
        moduleStates: {},
        features: [],
      }),
    ).toBe(true);
  });
});
