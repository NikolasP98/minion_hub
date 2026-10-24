import { describe, expect, it, vi } from 'vitest';
import { discoverPageEndpoints } from '$server/ui-audit/route-contract-filesystem';

const enforced = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('$lib/permissions', async (orig) => ({
  ...(await orig<typeof import('$lib/permissions')>()),
  get DATASET_ENFORCED() {
    return enforced.list;
  },
}));

import {
  EMPTY_NAV_CONFIG,
  addLink,
  addSection,
  aliasableTargets,
  canonicalInstancePath,
  duplicatePage,
  floorApplies,
  instanceAllowed,
  mainPathFor,
  moduleViewFloor,
  movePage,
  moveBuiltin,
  movedTargets,
  newId,
  normalizeNavConfig,
  removePage,
  removeSection,
  renameBuiltin,
  renamePage,
  renameSection,
  reservedSectionSlugs,
  resolveNavInstance,
  setHidden,
  slugify,
  validateNavConfig,
  visibleNavConfig,
  type NavConfig,
  type NavPage,
  type NavSection,
} from './custom-sections';

const page = (
  id: string,
  slug: string,
  target = '/pos/sell',
  over: Partial<NavPage> = {},
): NavPage => ({
  id,
  kind: 'link',
  slug,
  label: slug,
  target,
  ...over,
});
const section = (id: string, slug: string, pages: NavPage[] = []): NavSection => ({
  id,
  slug,
  label: slug,
  pages,
});
const cfg = (
  sections: NavSection[],
  builtinSections: NavConfig['builtinSections'] = {},
  builtin: NavConfig['builtin'] = {},
): NavConfig => ({ version: 1, sections, builtinSections, builtin });
const ctx = {
  reserved: reservedSectionSlugs(),
  targets: new Set(aliasableTargets().map((t) => t.pattern)),
};
const codes = (c: NavConfig) => validateNavConfig(c, ctx).map((i) => i.code);

const staff = () =>
  cfg(
    [
      section('st4ff1', 'staff', [
        page('k3x9q2', 'sell'),
        page('a1b2c3', 'appointments', '/pos/appointments', { kind: 'main' }),
      ]),
    ],
    { pos: [page('p0s001', 'sell')] },
  );

describe('reservedSectionSlugs', () => {
  it('covers every filesystem top-level route segment, locales and internals', () => {
    const fs = new Set(
      discoverPageEndpoints(process.cwd())
        .map((e) => e.pattern.split('/')[1])
        .filter(Boolean),
    );
    const reserved = reservedSectionSlugs();
    for (const seg of [...fs, 'en', 'es', 'api', '_app']) expect(reserved.has(seg)).toBe(true);
  });
});

describe('validateNavConfig', () => {
  it.each(['pos', 'api', 'en'])('rejects reserved slug %s', (slug) => {
    expect(codes(cfg([section('aaaaaa', slug)]))).toContain('slug.reserved');
  });
  it.each(['Staff', 'a_b', 'a'.repeat(33)])('rejects malformed slug %s', (slug) => {
    expect(codes(cfg([section('aaaaaa', slug)]))).toContain('slug.format');
  });
  it('rejects duplicate section slugs but allows duplicate page slugs', () => {
    expect(codes(cfg([section('aaaaaa', 'ops'), section('bbbbbb', 'ops')]))).toContain(
      'slug.duplicate',
    );
    const dup = cfg([section('aaaaaa', 'ops', [page('cccccc', 'a'), page('dddddd', 'a')])]);
    expect(codes(dup)).toEqual([]);
  });
  it('enforces limits', () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      section(`s0000${i % 10}`.slice(0, 5) + String.fromCharCode(97 + i), `s${i}`),
    );
    expect(codes(cfg(many))).toContain('limit');
    const pages = Array.from({ length: 31 }, (_, i) =>
      page(`p${String(i).padStart(5, '0')}`, `p${i}`),
    );
    expect(codes(cfg([section('aaaaaa', 'ops', pages)]))).toContain('limit');
  });
  it.each(['/pos', '/pos/catalog/[productId]/edit', '/login', '/book/[slug]'])(
    'rejects target %s',
    (target) => {
      expect(codes(cfg([section('aaaaaa', 'ops', [page('bbbbbb', 'a', target)])]))).toContain(
        'target.invalid',
      );
    },
  );
  it('rejects ids that are not 6 chars a-z0-9 or are duplicated across sections and builtinSections', () => {
    expect(codes(cfg([section('NOPE', 'ops')]))).toContain('id.invalid');
    expect(
      codes(cfg([section('aaaaaa', 'ops', [page('bbbbbb', 'a')])], { pos: [page('bbbbbb', 'b')] })),
    ).toContain('id.invalid');
  });
  it('allows one main per target only', () => {
    const m = (id: string) => page(id, 'x', '/pos/sell', { kind: 'main' });
    expect(codes(cfg([section('aaaaaa', 'ops', [m('bbbbbb'), m('cccccc')])]))).toContain(
      'main.duplicate',
    );
    expect(codes(cfg([section('aaaaaa', 'ops', [m('bbbbbb')])], { pos: [m('cccccc')] }))).toContain(
      'main.duplicate',
    );
  });
  it('rejects an unknown kind and an unknown builtinSections key', () => {
    const bad = page('bbbbbb', 'a', '/pos/sell', { kind: 'nope' as never });
    expect(codes(cfg([section('aaaaaa', 'ops', [bad])]))).toContain('kind.invalid');
    expect(codes(cfg([], { nope: [page('bbbbbb', 'a')] }))).toContain('section.unknown');
  });
  it('checks builtin override targets and labels', () => {
    expect(codes(cfg([], {}, { '/pos': { hidden: true } }))).toContain('target.invalid');
    expect(codes(cfg([], {}, { '/pos/sell': { label: '' } }))).toContain('label.length');
  });
  it('accepts a valid config (incl. ZWJ emoji icon)', () => {
    const s = section('aaaaaa', 'staff', [page('bbbbbb', 'sell')]);
    s.icon = '🧑‍⚕️';
    expect(codes(cfg([s]))).toEqual([]);
    expect(codes(staff())).toEqual([]);
  });
});

describe('resolveNavInstance / canonicalInstancePath', () => {
  const c = staff();
  it('resolves a custom-section link', () => {
    expect(resolveNavInstance(c, '/staff/sell~k3x9q2')).toMatchObject({
      target: '/pos/sell',
      rest: '',
      slugStale: false,
      sectionId: 'st4ff1',
      prefix: '/staff/sell~k3x9q2',
    });
  });
  it('keeps rest and flags a stale slug', () => {
    expect(resolveNavInstance(c, '/staff/till~k3x9q2/t/1')).toMatchObject({
      target: '/pos/sell',
      rest: '/t/1',
      slugStale: true,
    });
    expect(canonicalInstancePath(c, '/staff/till~k3x9q2/t/1')).toBe('/staff/sell~k3x9q2/t/1');
    expect(canonicalInstancePath(c, '/staff/sell~k3x9q2')).toBeNull();
  });
  it('resolves an instance in builtinSections', () => {
    expect(resolveNavInstance(c, '/pos/sell~p0s001')).toMatchObject({
      sectionId: null,
      target: '/pos/sell',
    });
  });
  it.each(['/other/sell~k3x9q2', '/staff/sell', '/pos/sell', '/pos/sell~zzzzzz', '/staff', '/'])(
    'returns null for %s',
    (p) => expect(resolveNavInstance(c, p)).toBeNull(),
  );
  it('tolerates a trailing slash', () => {
    expect(resolveNavInstance(c, '/staff/sell~k3x9q2/')?.rest).toBe('');
  });
});

describe('moved mains', () => {
  const c = staff();
  it('movedTargets / mainPathFor', () => {
    expect([...movedTargets(c)]).toEqual([['/pos/appointments', '/staff/appointments~a1b2c3']]);
    expect(mainPathFor(c, '/pos/appointments/new')).toBe('/staff/appointments~a1b2c3/new');
    expect(mainPathFor(c, '/pos/appointments')).toBe('/staff/appointments~a1b2c3');
    expect(mainPathFor(c, '/pos/sell')).toBeNull();
    expect(mainPathFor(c, '/pos/appointmentsx')).toBeNull();
  });
});

describe('module floor', () => {
  it('moduleViewFloor', () => {
    expect(moduleViewFloor('/pos/sell')).toBe('pos:view');
    expect(moduleViewFloor('/crm/insights')).toBe('crm:view');
    expect(moduleViewFloor('/settings/roles')).toBeNull();
    expect(moduleViewFloor('/home')).toBeNull();
  });
  it('floorApplies follows DATASET_ENFORCED', () => {
    expect(floorApplies('/pos/sell')).toBe(true);
    enforced.list = ['pos'];
    expect(floorApplies('/pos/sell')).toBe(false);
    expect(floorApplies('/crm/customers')).toBe(true);
    enforced.list = [];
  });
  it('instanceAllowed', () => {
    const p = page('k3x9q2', 'sell');
    expect(instanceAllowed(p, new Set(['page:k3x9q2:view', 'pos:view']))).toBe(true);
    expect(instanceAllowed(p, new Set(['pos:view']))).toBe(false);
    expect(instanceAllowed(p, new Set(['page:k3x9q2:view']))).toBe(false);
    enforced.list = ['pos'];
    expect(instanceAllowed(p, new Set(['page:k3x9q2:view']))).toBe(true);
    enforced.list = [];
  });
});

describe('visibleNavConfig', () => {
  const c = staff();
  c.sections[0].pages.push(page('h1dd3n', 'secret', '/pos/sell', { hidden: true }));
  c.builtin = { '/pos/sell': { label: 'Vender' } };
  const all = new Set(['k3x9q2', 'a1b2c3', 'h1dd3n', 'p0s001'].map((i) => `page:${i}:view`));
  it('drops ungranted instances (link or main) and passes builtin through', () => {
    const v = visibleNavConfig(c, new Set(['page:k3x9q2:view']), false);
    expect(v.sections[0].pages.map((p) => p.id)).toEqual(['k3x9q2']);
    expect(v.builtinSections).toEqual({});
    expect(v.builtin).toEqual(c.builtin);
    expect(visibleNavConfig(c, new Set(), false).sections).toEqual([]);
  });
  it('drops hidden unless the member can manage', () => {
    expect(visibleNavConfig(c, all, false).sections[0].pages.map((p) => p.id)).toEqual([
      'k3x9q2',
      'a1b2c3',
    ]);
    expect(visibleNavConfig(c, all, true).sections[0].pages.map((p) => p.id)).toEqual([
      'k3x9q2',
      'a1b2c3',
      'h1dd3n',
    ]);
    expect(visibleNavConfig(c, all, false).builtinSections.pos?.map((p) => p.id)).toEqual([
      'p0s001',
    ]);
  });
  it('drops a hidden section for non-managers', () => {
    const h = cfg([{ ...section('aaaaaa', 'ops', [page('bbbbbb', 'a')]), hidden: true }]);
    const g = new Set(['page:bbbbbb:view']);
    expect(visibleNavConfig(h, g, false).sections).toEqual([]);
    expect(visibleNavConfig(h, g, true).sections).toHaveLength(1);
  });
});

describe('operations', () => {
  it('newId / slugify', () => {
    expect(newId()).toMatch(/^[a-z0-9]{6}$/);
    expect(slugify('Ver Ventas!')).toBe('ver-ventas');
    expect(slugify('!!!')).toBe('page');
    expect(slugify('Ñandú')).toBe('and');
  });
  it('addLink appends to a section or a module and does not mutate', () => {
    const base = cfg([section('aaaaaa', 'ops')]);
    const snap = structuredClone(base);
    const a = addLink(base, { sectionId: 'aaaaaa' }, { target: '/pos/sell', label: 'Sell it' });
    expect(a.sections[0].pages[0]).toMatchObject({
      kind: 'link',
      slug: 'sell-it',
      target: '/pos/sell',
    });
    expect(a.sections[0].pages[0].id).toMatch(/^[a-z0-9]{6}$/);
    expect(
      addLink(base, { module: 'pos' }, { target: '/pos/sell', label: 'S' }).builtinSections.pos,
    ).toHaveLength(1);
    expect(base).toEqual(snap);
  });
  it('duplicatePage: next to the source, from a built-in main into builtinSections', () => {
    const c = staff();
    const d = duplicatePage(c, { pageId: 'k3x9q2' });
    expect(d.sections[0].pages.map((p) => p.slug)).toEqual(['sell', 'sell', 'appointments']);
    expect(d.sections[0].pages[1].id).not.toBe('k3x9q2');
    const m = duplicatePage(cfg([]), { target: '/pos/appointments', module: 'pos' });
    expect(m.builtinSections.pos[0]).toMatchObject({ kind: 'link', target: '/pos/appointments' });
    expect(m.builtinSections.pos[0].id).toMatch(/^[a-z0-9]{6}$/);
  });
  it('moveBuiltin removes a previous main and appends the new one', () => {
    const c = cfg([section('aaaaaa', 'one'), section('bbbbbb', 'two')]);
    const a = moveBuiltin(c, '/pos/sell', 'aaaaaa', 'Sell');
    const b = moveBuiltin(a, '/pos/sell', 'bbbbbb', 'Sell');
    expect(a.sections[0].pages[0].kind).toBe('main');
    expect(b.sections[0].pages).toEqual([]);
    expect(b.sections[1].pages[0]).toMatchObject({ kind: 'main', target: '/pos/sell' });
  });
  it('movePage keeps id and slug', () => {
    const m = movePage(staff(), 'k3x9q2', { module: 'crm' });
    expect(m.sections[0].pages.map((p) => p.id)).toEqual(['a1b2c3']);
    expect(m.builtinSections.crm[0]).toMatchObject({ id: 'k3x9q2', slug: 'sell' });
  });
  it('rename*', () => {
    expect(
      renamePage(staff(), 'k3x9q2', { label: 'X', slug: 'x' }).sections[0].pages[0],
    ).toMatchObject({
      label: 'X',
      slug: 'x',
    });
    expect(renameSection(staff(), 'st4ff1', { label: 'Crew' }).sections[0].label).toBe('Crew');
    const b = renameBuiltin(cfg([]), '/pos/sell', 'Vender');
    expect(b.builtin).toEqual({ '/pos/sell': { label: 'Vender' } });
    expect(renameBuiltin(b, '/pos/sell', null).builtin).toEqual({});
  });
  it('removePage drops the entry', () => {
    expect(removePage(staff(), 'a1b2c3').sections[0].pages.map((p) => p.id)).toEqual(['k3x9q2']);
    expect(removePage(staff(), 'p0s001').builtinSections).toEqual({});
  });
  it('setHidden on a page, a section and a built-in (clearing empties)', () => {
    expect(setHidden(staff(), { pageId: 'k3x9q2' }, true).sections[0].pages[0].hidden).toBe(true);
    expect(setHidden(staff(), { sectionId: 'st4ff1' }, true).sections[0].hidden).toBe(true);
    const b = setHidden(cfg([]), { target: '/pos/sell' }, true);
    expect(b.builtin).toEqual({ '/pos/sell': { hidden: true } });
    expect(setHidden(b, { target: '/pos/sell' }, false).builtin).toEqual({});
  });
  it('addSection / removeSection', () => {
    const a = addSection(cfg([]), { label: 'Ops', slug: 'ops' });
    expect(a.sections[0]).toMatchObject({ slug: 'ops', label: 'Ops', pages: [] });
    expect(removeSection(staff(), 'st4ff1').sections).toEqual([]);
  });
});

describe('aliasableTargets / normalizeNavConfig', () => {
  it('includes app screens, excludes containers, dynamic and auth routes', () => {
    const t = aliasableTargets().map((x) => x.pattern);
    expect(t).toEqual(expect.arrayContaining(['/pos/sell', '/settings/roles']));
    for (const bad of ['/pos', '/crm/[contactId]', '/login']) expect(t).not.toContain(bad);
  });
  it('reads {} / null as the empty config', () => {
    expect(normalizeNavConfig({})).toBe(EMPTY_NAV_CONFIG);
    expect(normalizeNavConfig(null)).toBe(EMPTY_NAV_CONFIG);
  });
  it('defaults missing maps and kind', () => {
    const n = normalizeNavConfig({
      version: 1,
      sections: [
        {
          id: 'aaaaaa',
          slug: 's',
          label: 's',
          pages: [{ id: 'bbbbbb', slug: 'a', label: 'a', target: '/pos/sell' }],
        },
      ],
    });
    expect(n.builtin).toEqual({});
    expect(n.builtinSections).toEqual({});
    expect(n.sections[0].pages[0].kind).toBe('link');
  });
});
