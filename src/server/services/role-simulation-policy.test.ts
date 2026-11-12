import { describe, expect, it } from 'vitest';
import { buildCapabilities, type CapabilityOverrideRow } from './rbac.service';
import {
  roleFitsActualAuthority,
  recipientGrantFitsActualAuthority,
} from './role-simulation-policy';
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

const recipientFit = (
  rules: CapabilityOverrideRow[],
  beforeRoles = ['retained'],
  afterRoles = ['retained', 'granted'],
  nav = EMPTY_NAV_CONFIG,
) =>
  recipientGrantFitsActualAuthority({
    before: buildCapabilities(beforeRoles, rules),
    after: buildCapabilities(afterRoles, rules),
    actual: buildCapabilities(['actual'], rules),
    rules,
    nav,
  });
describe('recipient data authority after role unions', () => {
  it('rejects hidden sensitivity metadata activated by a masked view grant', () => {
    const rows = [
      rule('actual', 'crm', { field_level: 0 }),
      rule('retained', 'crm', { can_view: false, field_level: 1 }),
      rule('granted', 'crm', { field_level: 0 }),
    ];
    expect(buildCapabilities(['granted'], rows).fieldLevel('crm')).toBe(0);
    expect(buildCapabilities(['retained', 'granted'], rows).fieldLevel('crm')).toBe(1);
    expect(recipientFit(rows)).toBe(false);
  });
  it('rejects unrestricted edits assembled from unrestricted read plus owner-scoped edit', () => {
    const rows = [
      rule('actual', 'crm', { can_edit: true, if_owner: true, field_level: 0 }),
      rule('retained', 'crm', { field_level: 0 }),
      rule('granted', 'crm', { can_edit: true, if_owner: true, field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('checks sensitive fields when view record scope widens without a tier change', () => {
    const rows = [
      rule('actual', 'crm', { field_level: 0 }),
      rule('retained', 'crm', { if_owner: true, field_level: 1 }),
      rule('granted', 'crm', { field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('requires the actor record scope for newly exposed sensitive fields', () => {
    const rows = [
      rule('actual', 'crm', { if_owner: true, field_level: 1 }),
      rule('retained', 'crm', { field_level: 0 }),
      rule('granted', 'crm', { field_level: 1 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('checks latent sensitive fields when export becomes newly available', () => {
    const rows = [
      rule('actual', 'crm', { can_export: true, field_level: 0 }),
      rule('retained', 'crm', { field_level: 1 }),
      rule('granted', 'crm', { can_export: true, field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('checks sensitive fields when an existing export record scope widens', () => {
    const rows = [
      rule('actual', 'crm', { can_export: true, field_level: 0 }),
      rule('retained', 'crm', { can_export: true, if_owner: true, field_level: 1 }),
      rule('granted', 'crm', { can_export: true, field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('requires export authority when a retained export gains a higher field tier', () => {
    const rows = [
      rule('actual', 'crm', { field_level: 1 }),
      rule('retained', 'crm', { can_export: true, field_level: 0 }),
      rule('granted', 'crm', { field_level: 1 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('checks inherited subresource actions against the complete recipient union', () => {
    const rows = [
      rule('actual', 'crm', { can_edit: true, if_owner: true, field_level: 0 }),
      rule('retained', 'crm', { can_view: false, field_level: 0 }),
      rule('retained', 'crm.customers', { field_level: 0 }),
      rule('granted', 'crm', { can_edit: true, if_owner: true, field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(false);
  });
  it('checks a newly visible custom page after combining role page rules', () => {
    const rows = [
      rule('actual', 'crm', { field_level: 0 }),
      rule('actual', 'page:abc123', { can_view: false }),
      rule('retained', 'crm', { field_level: 0 }),
      rule('retained', 'page:abc123', { can_view: false }),
      rule('granted', 'crm', { can_view: false, field_level: 0 }),
      rule('granted', 'page:abc123'),
    ];
    const nav = {
      ...EMPTY_NAV_CONFIG,
      builtinSections: {
        crm: [
          {
            id: 'abc123',
            slug: 'clients',
            label: 'Clients',
            kind: 'link' as const,
            target: '/crm/customers',
          },
        ],
      },
    };
    expect(recipientFit(rows, undefined, undefined, nav)).toBe(false);
  });
  it('checks newly effective native page and custom section visibility', () => {
    const native = [
      rule('actual', 'crm'),
      rule('actual', 'page:/crm/customers', { can_view: false }),
      rule('retained', 'crm'),
      rule('retained', 'page:/crm/customers', { can_view: false }),
      rule('granted', 'page:/crm/customers'),
    ];
    expect(recipientFit(native)).toBe(false);
    const sections = [
      rule('actual', 'section:abc123', { can_view: false }),
      rule('retained', 'section:abc123', { can_view: false }),
      rule('granted', 'section:abc123'),
    ];
    const nav = {
      ...EMPTY_NAV_CONFIG,
      sections: [{ id: 'abc123', slug: 'custom', label: 'Custom', pages: [] }],
    };
    expect(recipientFit(sections, undefined, undefined, nav)).toBe(false);
  });
  it('retains unrelated higher baseline rights while granting authority the actor holds', () => {
    const rows = [
      rule('actual', 'finance'),
      rule('retained', 'crm', { can_edit: true, field_level: 1 }),
      rule('granted', 'finance'),
    ];
    expect(recipientFit(rows)).toBe(true);
  });
  it('allows reductions even when the actor does not hold the retained higher rights', () => {
    const rows = [
      rule('retained', 'crm', { can_edit: true, field_level: 1 }),
      rule('granted', 'crm', { if_owner: true, field_level: 0 }),
    ];
    expect(recipientFit(rows, ['retained'], ['granted'])).toBe(true);
  });
  it('allows a union that fits the actor sensitivity and unrestricted record authority', () => {
    const rows = [
      rule('actual', 'crm', { can_edit: true, field_level: 1 }),
      rule('retained', 'crm', { field_level: 1 }),
      rule('granted', 'crm', { can_edit: true, if_owner: true, field_level: 0 }),
    ];
    expect(recipientFit(rows)).toBe(true);
  });
});

describe('recipient management authority after rank unions', () => {
  it.each(['create', 'edit', 'delete'] as const)(
    'cannot lend retained rank80 through new roles:%s from rank60',
    (action) => {
      const rows = [
        rule('actual', 'roles', { ['can_' + action]: true }),
        rule('granted', 'roles', { ['can_' + action]: true }),
      ];
      expect(
        recipientGrantFitsActualAuthority({
          before: buildCapabilities(['retained'], rows),
          after: buildCapabilities(['retained', 'granted'], rows),
          actual: buildCapabilities(['actual'], rows),
          rules: rows,
          nav: EMPTY_NAV_CONFIG,
          ranks: { before: 80, after: 80, actual: 60 },
        }),
      ).toBe(false);
    },
  );
  it('cannot lend retained rank80 through new Team management from rank60', () => {
    const rows = [
      rule('actual', 'users', { can_manage: true }),
      rule('granted', 'users', { can_manage: true }),
    ];
    expect(
      recipientGrantFitsActualAuthority({
        before: buildCapabilities(['retained'], rows),
        after: buildCapabilities(['retained', 'granted'], rows),
        actual: buildCapabilities(['actual'], rows),
        rules: rows,
        nav: EMPTY_NAV_CONFIG,
        ranks: { before: 80, after: 80, actual: 60 },
      }),
    ).toBe(false);
  });
  it('checks a rank increase when management actions were already available', () => {
    const rows = [rule('management', 'roles', { can_edit: true })],
      capabilities = buildCapabilities(['management'], rows);
    expect(
      recipientGrantFitsActualAuthority({
        before: capabilities,
        after: capabilities,
        actual: capabilities,
        rules: rows,
        nav: EMPTY_NAV_CONFIG,
        ranks: { before: 40, after: 80, actual: 60 },
      }),
    ).toBe(false);
  });
  it('does not reauthorize unchanged higher-rank management authority', () => {
    const rows = [rule('management', 'roles', { can_edit: true })],
      capabilities = buildCapabilities(['management'], rows);
    expect(
      recipientGrantFitsActualAuthority({
        before: capabilities,
        after: capabilities,
        actual: capabilities,
        rules: rows,
        nav: EMPTY_NAV_CONFIG,
        ranks: { before: 80, after: 80, actual: 60 },
      }),
    ).toBe(true);
  });
  it.each(['roles', 'crm'])(
    'allows a %s view-only grant without treating read as management',
    (module) => {
      const rows = [rule('actual', module), rule('granted', module)];
      expect(
        recipientGrantFitsActualAuthority({
          before: buildCapabilities(['retained'], rows),
          after: buildCapabilities(['retained', 'granted'], rows),
          actual: buildCapabilities(['actual'], rows),
          rules: rows,
          nav: EMPTY_NAV_CONFIG,
          ranks: { before: 80, after: 80, actual: 60 },
        }),
      ).toBe(true);
    },
  );
});
