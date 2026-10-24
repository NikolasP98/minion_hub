import { describe, expect, it } from 'vitest';
import { getNavSections } from '$lib/components/layout/sections';
import { EMPTY_NAV_CONFIG, type NavConfig, type NavPage } from './custom-sections';
import { builtinInstances, customModules, customSections } from './custom-sections-nav';
import { getAreaItems, getModules, resolveModuleForNav } from './modules';

const page = (id: string, slug: string, target: string, over: Partial<NavPage> = {}): NavPage => ({
  id,
  kind: 'link',
  slug,
  label: slug,
  target,
  ...over,
});
const staff = (over: Partial<NavConfig> = {}): NavConfig => ({
  version: 1,
  sections: [
    {
      id: 'st4ff1',
      slug: 'staff',
      label: 'Staff',
      pages: [
        page('k3x9q2', 'sell', '/pos/sell'),
        page('a1b2c3', 'appointments', '/pos/appointments', { kind: 'main' }),
      ],
    },
  ],
  builtinSections: {},
  builtin: {},
  ...over,
});
const pos = (c: NavConfig) => getAreaItems('pos', { schedulingEnabled: true, navConfig: c });

describe('customSections', () => {
  it('yields one accent section with instance hrefs and matchers', () => {
    const [s, ...rest] = customSections(staff());
    expect(rest).toEqual([]);
    expect(s.id).toBe('custom:st4ff1');
    expect(s.tone).toBe('accent');
    expect(s.items.map((i) => i.href)).toEqual([
      '/staff/sell~k3x9q2',
      '/staff/appointments~a1b2c3',
    ]);
    expect(s.items[0].matcher('/staff/sell~k3x9q2')).toBe(true);
    expect(s.items[1].matcher('/staff/appointments~a1b2c3/new')).toBe(true);
    expect(s.items[1].matcher('/pos/sell')).toBe(false);
  });
  it('drops hidden pages/sections, invalid targets and reserved slugs', () => {
    const c = staff();
    c.sections[0].pages[0].hidden = true;
    c.sections[0].pages[1].target = '/nope/nothing';
    expect(customSections(c)).toEqual([]);
    expect(customSections(staff({ sections: [{ ...staff().sections[0], hidden: true }] }))).toEqual(
      [],
    );
    expect(customSections(staff({ sections: [{ ...staff().sections[0], slug: 'pos' }] }))).toEqual(
      [],
    );
  });
});

describe('customModules / getModules', () => {
  it('builds a module with first-page href and prefix matcher, after built-ins', () => {
    const [mod] = customModules(staff());
    expect(mod.id).toBe('custom:st4ff1');
    expect(mod.href).toBe('/staff/sell~k3x9q2');
    expect(mod.matcher('/staff')).toBe(true);
    expect(mod.matcher('/stafford')).toBe(false);
    expect(mod.items.map((i) => i.id)).toEqual(['k3x9q2', 'a1b2c3']);
    const mods = getModules({ schedulingEnabled: true, navConfig: staff() });
    expect(mods.at(-1)?.id).toBe('custom:st4ff1');
    expect(mods.find((x) => x.id === 'pos')?.items.map((i) => i.href)).not.toContain(
      '/pos/appointments',
    );
  });
  it('resolveModuleForNav finds the custom module', () => {
    expect(resolveModuleForNav('/staff/sell', { navConfig: staff() })?.id).toBe('custom:st4ff1');
  });
});

describe('built-in overrides', () => {
  it('moved main leaves the POS nav', () => {
    expect(pos(staff()).map((i) => i.href)).not.toContain('/pos/appointments');
    expect(pos(EMPTY_NAV_CONFIG).map((i) => i.href)).toContain('/pos/appointments');
  });
  it('appends builtinSections instances in the last group', () => {
    const c = staff({ builtinSections: { pos: [page('d0p1e2', 'sell', '/pos/sell')] } });
    const items = pos(c);
    const last = items.at(-1)!;
    expect(last.href).toBe('/pos/sell~d0p1e2');
    expect(last.group).toBe(items.at(-2)!.group);
    expect(builtinInstances(c, 'pos')).toHaveLength(1);
  });
  it('relabels and hides', () => {
    const c = (b: NavConfig['builtin']) => ({ ...EMPTY_NAV_CONFIG, builtin: b });
    expect(
      pos(c({ '/pos/sell': { label: 'Till' } })).find((i) => i.href === '/pos/sell')?.label,
    ).toBe('Till');
    expect(pos(c({ '/pos/sell': { hidden: true } })).map((i) => i.href)).not.toContain('/pos/sell');
  });
});

describe('getNavSections', () => {
  it('appends the custom section last', () => {
    expect(getNavSections('business', [], {}, staff()).at(-1)?.id).toBe('custom:st4ff1');
  });
  it('empty config is identical to the no-arg call (SC-003)', () => {
    // matchers are fresh closures per call, so compare the serialisable shape
    const shape = (xs: { id: string; label: string; items: { href: string; label: string }[] }[]) =>
      xs.map((x) => [x.id, x.label, x.items.map((i) => [i.href, i.label])]);
    expect(shape(getNavSections('business', [], {}, EMPTY_NAV_CONFIG))).toEqual(
      shape(getNavSections('business', [], {})),
    );
    expect(shape(getModules({ navConfig: EMPTY_NAV_CONFIG }))).toEqual(shape(getModules()));
  });
});
