import { describe, expect, it } from 'vitest';
import { buildCapabilities, type CapabilityOverrideRow } from './rbac.service';
import { roleFitsActualAuthority } from './role-simulation-policy';
import { EMPTY_NAV_CONFIG } from '$lib/nav/custom-sections';
import {
  safeSimulationReturn,
  simulationDestination,
  simulationRouteAllowed,
} from './simulation-navigation';
const rule = (
  role_key: string,
  module: string,
  extra: Partial<CapabilityOverrideRow> = {},
): CapabilityOverrideRow => ({
  role_key,
  module,
  can_view: true,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_export: false,
  can_manage: false,
  ...extra,
});
const fit = (rules: CapabilityOverrideRow[]) =>
  roleFitsActualAuthority({
    actual: buildCapabilities(['actual'], rules),
    selected: buildCapabilities(['selected'], rules),
    rules,
    nav: EMPTY_NAV_CONFIG,
    platformAdmin: false,
  });
describe('simulation complete authority containment', () => {
  it('rejects action, record-scope and field-tier escalation independently', () => {
    expect(fit([rule('actual', 'crm'), rule('selected', 'crm', { can_edit: true })])).toBe(false);
    expect(fit([rule('actual', 'crm', { if_owner: true }), rule('selected', 'crm')])).toBe(false);
    expect(
      fit([rule('actual', 'crm', { field_level: 0 }), rule('selected', 'crm', { field_level: 1 })]),
    ).toBe(false);
    expect(
      fit([rule('actual', 'crm'), rule('selected', 'crm', { if_owner: true, field_level: 0 })]),
    ).toBe(true);
  });
  it('compares inherited subresources and page/section exceptions instead of only role rank', () => {
    expect(
      fit([
        rule('actual', 'crm'),
        rule('selected', 'crm'),
        rule('selected', 'crm.customers', { can_delete: true }),
      ]),
    ).toBe(false);
    const rules = [
      rule('actual', 'crm'),
      rule('selected', 'crm'),
      rule('actual', 'page:/crm/customers', { can_view: false }),
    ];
    expect(fit(rules)).toBe(false);
  });
  it('replaces actual roles and preserves an explicitly denied native page', () => {
    const selected = buildCapabilities(
      ['viewer'],
      [rule('viewer', 'page:/crm/customers', { can_view: false })],
    );
    expect(selected.can('users', 'manage')).toBe(false);
    expect(
      simulationRouteAllowed('/crm/customers', { nav: EMPTY_NAV_CONFIG, capabilities: selected }),
    ).toBe(false);
  });
});
describe('bounded simulation navigation', () => {
  it.each([
    '//evil.invalid',
    '/\\evil.invalid',
    'https://evil.invalid',
    '/%2f%2fevil.invalid',
    '/a\nb',
  ])('rejects unsafe return %s', (value) => {
    expect(safeSimulationReturn(value)).toBeNull();
  });
  it('keeps an allowed localized route and its query, falling back without carrying old query', () => {
    const ctx = { nav: EMPTY_NAV_CONFIG, capabilities: buildCapabilities(['viewer'], []) };
    expect(simulationDestination({ current: '/es/crm/customers?view=list', ctx, orgId: 'o' })).toBe(
      '/es/crm/customers?view=list',
    );
    expect(simulationDestination({ current: '/es/home', ctx, orgId: 'o' })).toBe('/es/home');
    const next = simulationDestination({ current: '/es/settings/roles?danger=1', ctx, orgId: 'o' });
    expect(next).not.toContain('danger=1');
    expect(next).not.toContain('/settings/roles');
  });
  it('returns one avatar-capable shell for a role denying every native screen', () => {
    const caps = buildCapabilities([], []);
    const result = simulationDestination({
      current: '/es/settings/roles',
      ctx: { nav: EMPTY_NAV_CONFIG, capabilities: caps },
      orgId: 'o',
    });
    expect(result).toBe('/es/account/home');
  });
});

describe('documented catalog/navigation qualification envelope', () => {
  it('evaluates 200 roles without truncation and terminates across 500 denied alias targets', () => {
    const nav = {
      version: 1 as const,
      builtin: {},
      builtinSections: {},
      sections: Array.from({ length: 20 }, (_, i) => ({
        id: i.toString(36).padStart(6, '0'),
        slug: `section-${i}`,
        label: `Section ${i}`,
        pages: Array.from({ length: 25 }, (_, j) => ({
          id: (i * 25 + j).toString(36).padStart(6, '0'),
          kind: 'link' as const,
          slug: `page-${j}`,
          label: `Page ${j}`,
          target: '/crm/customers',
        })),
      })),
    };
    const actual = buildCapabilities(['owner'], []);
    const results = Array.from({ length: 200 }, (_, i) =>
      roleFitsActualAuthority({
        actual,
        selected: buildCapabilities([`custom-role-${i}`], []),
        rules: [],
        nav,
        platformAdmin: false,
      }),
    );
    expect(results).toHaveLength(200);
    expect(results.every(Boolean)).toBe(true);
    const rules = [
      rule('custom-empty', 'overview', { can_view: false }),
      rule('custom-empty', 'page:/home', { can_view: false }),
      rule('custom-empty', 'page:/overview', { can_view: false }),
    ];
    expect(
      simulationDestination({
        current: '/es/settings/roles',
        ctx: { nav, capabilities: buildCapabilities(['custom-empty'], rules) },
        orgId: 'o',
      }),
    ).toBe('/es/account/home');
  });
});
