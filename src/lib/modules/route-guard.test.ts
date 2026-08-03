import { describe, test, expect } from 'vitest';
import { canonicalPath } from '$lib/canonical-path';
import { isAppPageRequest, isAppRouteBlocked } from './route-guard';

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

describe('isAppRouteBlocked — locale + longest-prefix composition (R6: canonicalization stays separate)', () => {
  test('locale-prefixed path resolves the same as its canonical form', () => {
    const ctx = { kind: 'business' as const, moduleStates: {} };
    expect(isAppRouteBlocked(canonicalPath('/es/pulse'), ctx)).toBe(true);
    expect(isAppRouteBlocked(canonicalPath('/en/pos/sell'), ctx)).toBe(false);
  });

  test('/settings/pulse (localized) still resolves to pulse via longest-prefix, not a bare /settings', () => {
    const business = { kind: 'business' as const, moduleStates: {} };
    const personal = { kind: 'personal' as const, moduleStates: {} };
    expect(isAppRouteBlocked(canonicalPath('/es/settings/pulse'), business)).toBe(true);
    expect(isAppRouteBlocked(canonicalPath('/settings/pulse'), personal)).toBe(false);
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

  test('personal org: /pulse passes', () => {
    const ctx = { kind: 'personal' as const, moduleStates: {} };
    expect(isAppRouteBlocked('/pulse', ctx)).toBe(false);
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
