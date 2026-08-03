import { describe, test, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODULE_MANIFEST,
  resolveModuleForPath,
  isModuleAvailable,
  effectiveModuleEnabled,
} from './availability';

// NOTE (S3/WP1, specs/2026-07-22-personal-org-differentiation-spec.md R1):
// this file originally characterized the kind matrix as it existed BEFORE
// the personal-org-differentiation policy expansion. support/memberships/
// sales/ads/team are now DELIBERATELY kind-gated (personal hides them) —
// the tests below reflect the new intended matrix, not a behavior-preserving
// snapshot. `team` also went from CORE_UNMANAGED to a manifest entry.

describe('resolveModuleForPath', () => {
  test('longest-prefix wins: /settings/pulse resolves to pulse, not a bare /settings entry', () => {
    expect(resolveModuleForPath('/settings/pulse')?.moduleId).toBe('pulse');
    expect(resolveModuleForPath('/settings/pulse/anything')?.moduleId).toBe('pulse');
  });

  test('/pulse resolves to pulse directly', () => {
    expect(resolveModuleForPath('/pulse')?.moduleId).toBe('pulse');
    expect(resolveModuleForPath('/pulse/history')?.moduleId).toBe('pulse');
  });

  test('alias: /socials resolves to the ads module id', () => {
    expect(resolveModuleForPath('/socials')?.moduleId).toBe('ads');
    expect(resolveModuleForPath('/socials/campaigns/x')?.moduleId).toBe('ads');
  });

  test('composite: /pos/appointments resolves to posAppointments, not pos', () => {
    expect(resolveModuleForPath('/pos/appointments')?.moduleId).toBe('posAppointments');
    expect(resolveModuleForPath('/pos/appointments/today')?.moduleId).toBe('posAppointments');
  });

  test('other /pos subpaths still resolve to pos', () => {
    expect(resolveModuleForPath('/pos/sell')?.moduleId).toBe('pos');
    expect(resolveModuleForPath('/pos')?.moduleId).toBe('pos');
  });

  test('a path that is a prefix of a manifest prefix does not match (no false positive)', () => {
    expect(resolveModuleForPath('/po')).toBeNull();
    expect(resolveModuleForPath('/socialsx')).toBeNull();
  });

  test('/team resolves to the team module', () => {
    expect(resolveModuleForPath('/team')?.moduleId).toBe('team');
    expect(resolveModuleForPath('/team/roster')?.moduleId).toBe('team');
  });

  test('/settings/team resolves to team via longest-prefix, not a bare /settings entry', () => {
    expect(resolveModuleForPath('/settings/team')?.moduleId).toBe('team');
  });

  test('unknown path resolves to null', () => {
    expect(resolveModuleForPath('/home')).toBeNull();
    expect(resolveModuleForPath('/nonexistent')).toBeNull();
  });
});

describe('isModuleAvailable — kind matrix (org-kind.ts ORG_KIND_POLICY, S3/WP1 DELIBERATE expansion)', () => {
  test('pulse: hidden for business, visible for personal', () => {
    expect(isModuleAvailable('pulse', { kind: 'business', moduleStates: {} })).toBe(false);
    expect(isModuleAvailable('pulse', { kind: 'personal', moduleStates: {} })).toBe(true);
  });

  test('pos/stock/workforce: hidden for personal, visible for business', () => {
    for (const moduleId of ['pos', 'stock', 'workforce']) {
      expect(isModuleAvailable(moduleId, { kind: 'personal', moduleStates: {} })).toBe(false);
      expect(isModuleAvailable(moduleId, { kind: 'business', moduleStates: {} })).toBe(true);
    }
  });

  test('support/memberships/sales/ads/team: hidden for personal, visible for business (S3/WP1 addition)', () => {
    for (const moduleId of ['support', 'memberships', 'sales', 'ads', 'team']) {
      expect(isModuleAvailable(moduleId, { kind: 'personal', moduleStates: {} })).toBe(false);
      expect(isModuleAvailable(moduleId, { kind: 'business', moduleStates: {} })).toBe(true);
    }
  });

  test('crm/finances/scheduling remain available for both kinds', () => {
    for (const moduleId of ['crm', 'finances', 'scheduling']) {
      expect(isModuleAvailable(moduleId, { kind: 'personal', moduleStates: {} })).toBe(true);
      expect(isModuleAvailable(moduleId, { kind: 'business', moduleStates: {} })).toBe(true);
    }
  });

  test('unknown/undefined kind degrades to business (matches org-kind.ts)', () => {
    expect(isModuleAvailable('pulse', { kind: undefined, moduleStates: {} })).toBe(false);
    expect(isModuleAvailable('pulse', { kind: null, moduleStates: {} })).toBe(false);
    expect(isModuleAvailable('pos', { kind: undefined, moduleStates: {} })).toBe(true);
    expect(isModuleAvailable('team', { kind: undefined, moduleStates: {} })).toBe(true);
  });
});

describe('isModuleAvailable — module-toggle states', () => {
  test('missing row in moduleStates = enabled (modules.service.ts:26 semantics)', () => {
    expect(isModuleAvailable('crm', { kind: 'business', moduleStates: {} })).toBe(true);
    expect(isModuleAvailable('finances', { kind: 'business', moduleStates: {} })).toBe(true);
  });

  test('explicit false in moduleStates disables a toggleable module', () => {
    expect(isModuleAvailable('finances', { kind: 'business', moduleStates: { finances: false } })).toBe(false);
    expect(isModuleAvailable('crm', { kind: 'business', moduleStates: { crm: false } })).toBe(false);
  });

  test('explicit true is a no-op (same as absent)', () => {
    expect(isModuleAvailable('sales', { kind: 'business', moduleStates: { sales: true } })).toBe(true);
  });

  test('a module without a toggleId is never disabled by moduleStates (memberships, workforce)', () => {
    expect(
      isModuleAvailable('memberships', { kind: 'business', moduleStates: { memberships: false } }),
    ).toBe(true);
    expect(
      isModuleAvailable('workforce', { kind: 'business', moduleStates: { workforce: false } }),
    ).toBe(true);
  });
});

describe('isModuleAvailable — composite deps (/pos/appointments)', () => {
  test('available when both pos and scheduling are available', () => {
    expect(isModuleAvailable('posAppointments', { kind: 'business', moduleStates: {} })).toBe(true);
  });

  test('unavailable when scheduling is toggled off, even though pos is enabled', () => {
    expect(
      isModuleAvailable('posAppointments', {
        kind: 'business',
        moduleStates: { pos: true, scheduling: false },
      }),
    ).toBe(false);
  });

  test('unavailable when pos is toggled off, even though scheduling is enabled', () => {
    expect(
      isModuleAvailable('posAppointments', {
        kind: 'business',
        moduleStates: { pos: false, scheduling: true },
      }),
    ).toBe(false);
  });

  test('unavailable for personal orgs (inherits pos\'s business-only kind gate transitively)', () => {
    expect(isModuleAvailable('posAppointments', { kind: 'personal', moduleStates: {} })).toBe(false);
  });
});

describe('isModuleAvailable — unmanaged module ids', () => {
  test('an id with no manifest entry is always available (unmanaged, not gated by this predicate)', () => {
    expect(isModuleAvailable('home', { kind: 'business', moduleStates: {} })).toBe(true);
    expect(isModuleAvailable('settings', { kind: 'personal', moduleStates: { settings: false } })).toBe(true);
  });
});

describe('effectiveModuleEnabled (S3/WP1 R6)', () => {
  test('kind-hidden feature is disabled regardless of moduleStates', () => {
    expect(effectiveModuleEnabled('personal', {}, 'stock')).toBe(false);
    expect(effectiveModuleEnabled('personal', { stock: true }, 'stock')).toBe(false);
  });

  test('kind-visible + toggle-off is disabled', () => {
    expect(effectiveModuleEnabled('business', { finances: false }, 'finances')).toBe(false);
  });

  test('kind-visible + toggle-absent/true is enabled', () => {
    expect(effectiveModuleEnabled('business', {}, 'finances')).toBe(true);
    expect(effectiveModuleEnabled('personal', {}, 'crm')).toBe(true);
  });

  test('works for feature ids with no MODULE_MANIFEST entry (e.g. a Connections panel group key)', () => {
    expect(effectiveModuleEnabled('business', {}, 'sales')).toBe(true);
    expect(effectiveModuleEnabled('personal', {}, 'sales')).toBe(false);
    expect(effectiveModuleEnabled('personal', { sales: true }, 'sales')).toBe(false);
  });

  test('undefined/null kind degrades to business (matches org-kind.ts)', () => {
    expect(effectiveModuleEnabled(undefined, {}, 'stock')).toBe(true);
    expect(effectiveModuleEnabled(null, {}, 'pulse')).toBe(false);
  });
});

/**
 * Filesystem sweep: every top-level (app) route directory must be either
 * mapped by MODULE_MANIFEST (its first path segment resolves to a manifest
 * entry) or explicitly listed in CORE_UNMANAGED with a reason. This is
 * coverage documentation only — it does not gate anything (S1 is
 * characterization; wiring is a later step) — and mirrors the intent of the
 * routing-simplification spec's W1 "must map to a manifest entry" test
 * without replacing the route-design-contract suites (R7: those stay
 * independent).
 */
const CORE_UNMANAGED: Record<string, string> = {
  account: 'core account settings, no module toggle',
  ads: 'legacy 301 redirect to /socials (ads/+page.server.ts) — R6 keeps redirects out of the availability manifest',
  agents: 'core agent-stack roster, no module toggle',
  brains: 'core agent-stack (AI Brains), no module toggle',
  builder: 'legacy 308 redirect to /agents/builder',
  capabilities: 'core agent-stack (aliased with /tools), no module toggle',
  channels: 'core channel management, no module toggle',
  cloud: 'core cloud workstation, no module toggle',
  config: 'core gateway config editor, no module toggle',
  'flow-editor': 'core agent-stack (agent builder), no module toggle',
  home: 'core landing page, no module toggle',
  killswitches: 'core admin surface, no module toggle',
  marketplace: 'core plugin browsing, no module toggle',
  notifications: 'core, no module toggle',
  orgs: 'core org switching, no module toggle',
  overview: 'core org graph, no module toggle',
  plugins: 'core installed-plugin management, no module toggle',
  prompt: 'core agent-stack (prompt tools), no module toggle',
  reliability: 'core platform health, no module toggle',
  sessions: 'core, no module toggle',
  settings:
    'core settings shell; /settings/pulse and /settings/team specifically are mapped via the pulse/team entries',
  shells: 'core terminal shells, no module toggle',
  terminal: 'core terminal access, no module toggle',
  tools: 'core agent-stack (aliased with /capabilities), no module toggle',
  users: 'core user management, no module toggle',
  work: 'core "My Work" inbox, no module toggle',
  workshop: 'legacy 308 redirect to /agents/workshop',
};

describe('filesystem coverage sweep', () => {
  test('every top-level (app) route dir is manifest-mapped or explicitly CORE_UNMANAGED', () => {
    const appDir = fileURLToPath(new URL('../../routes/(app)/', import.meta.url));
    const topLevelDirs = readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    const mappedFirstSegments = new Set(
      Object.values(MODULE_MANIFEST).flatMap((entry) =>
        entry.appPrefixes.map((p) => p.replace(/^\//, '').split('/')[0]),
      ),
    );

    const unaccounted = topLevelDirs.filter(
      (dir) => !mappedFirstSegments.has(dir) && !(dir in CORE_UNMANAGED),
    );
    expect(unaccounted).toEqual([]);

    // Guard the allowlist itself: no stale entries for dirs that no longer exist.
    const staleAllowlistEntries = Object.keys(CORE_UNMANAGED).filter(
      (dir) => !topLevelDirs.includes(dir),
    );
    expect(staleAllowlistEntries).toEqual([]);
  });
});
