import { availableLanguageTags } from '$lib/paraglide/runtime';
import { DATASET_ENFORCED } from '$lib/permissions';
import { PLUGIN_ICON_MAP } from '$lib/plugins/icon-map';
import { PUBLIC_ROUTE_PATTERNS, ROUTE_ACCESS_RULES } from '$lib/routes/route-access-registry';
import { ROUTE_DESIGN_MANIFEST, SCREEN_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';

/**
 * Custom navigation sections with link / moved-main pages (meta spec 037,
 * Amendments A + B). Pure model: no Svelte, no `$lib/i18n` — shared by the
 * layout, API handlers and tests. Page view rules are NOT in the document: they
 * are `permission_rules` rows surfaced as `page:<id>:view` permission strings.
 */

export type NavPageKind = 'link' | 'main';
export interface NavPage {
  /** `^[a-z0-9]{6}$` — part of the URL (`/<section>/<slug>~<id>`); page-rule key `page:<id>`. */
  id: string;
  /** 'link' = alias of target; 'main' = the target's canonical location moved here. */
  kind: NavPageKind;
  /** Cosmetic: the resolver matches the id. */
  slug: string;
  label: string;
  icon?: string;
  /** Static (app) screen pattern from SCREEN_DESIGN_MANIFEST, e.g. '/pos/sell'. */
  target: string;
  /** Org-wide nav hide; absent = shown. */
  hidden?: true;
}
export interface NavSection {
  id: string;
  slug: string;
  label: string;
  icon?: string;
  hidden?: true;
  pages: NavPage[];
}
/** Overrides for built-in pages that stay in their native nav. */
export interface BuiltinOverride {
  label?: string;
  hidden?: true;
}
export interface NavConfig {
  version: 1;
  sections: NavSection[];
  /** Instances placed INTO a built-in module's nav (`/pos/sell~k3x9q2`), keyed by module segment. */
  builtinSections: Record<string, NavPage[]>;
  /** Keyed by target pattern. */
  builtin: Record<string, BuiltinOverride>;
}
export const EMPTY_NAV_CONFIG: NavConfig = {
  version: 1,
  sections: [],
  builtinSections: {},
  builtin: {},
};

export const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const NAV_LIMITS = { sections: 20, pages: 30, label: 40 } as const;
export const INTERNAL_PREFIXES = [
  'api',
  '_app',
  'ingest',
  '.well-known',
  'vendor',
  'icons',
  'static',
  'favicon.ico',
  'manifest.webmanifest',
  'service-worker.js',
  'robots.txt',
] as const;

export const ID_RE = /^[a-z0-9]{6}$/;
const NON_APP_TARGETS = /^\/(login|auth|book|invite|join|onboarding|artifacts|link)(\/|$)/;

/** First path segments a section slug must never shadow (derived, not listed). */
export function reservedSectionSlugs(): ReadonlySet<string> {
  const reserved = new Set<string>([...availableLanguageTags, ...INTERNAL_PREFIXES]);
  for (const route of ROUTE_DESIGN_MANIFEST) {
    const first = route.pattern.split('/')[1];
    if (first) reserved.add(first);
  }
  return reserved;
}

/** Static in-app screens an alias page may point at. */
export function aliasableTargets(): { pattern: string; title: string }[] {
  const pub = new Set<string>(PUBLIC_ROUTE_PATTERNS);
  return SCREEN_DESIGN_MANIFEST.filter(
    (r) => !r.pattern.includes('[') && !pub.has(r.pattern) && !NON_APP_TARGETS.test(r.pattern),
  ).map((r) => ({ pattern: r.pattern, title: r.title() }));
}

/** First path segments of real app routes: the keys `builtinSections` may use. */
function moduleSegments(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const route of ROUTE_DESIGN_MANIFEST) {
    const first = route.pattern.split('/')[1];
    if (first) out.add(first);
  }
  return out;
}

const moduleOf = (target: string): string => target.split('/')[1] ?? '';
const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/$/, '') : p);

// ── paths ────────────────────────────────────────────────────────────────

export const instancePath = (sectionSlug: string, page: Pick<NavPage, 'slug' | 'id'>): string =>
  `/${sectionSlug}/${page.slug}~${page.id}`;

/** 6 base36 chars; callers re-roll on collision within the document. */
export function newId(): string {
  const n = parseInt(crypto.randomUUID().slice(0, 8), 16);
  return n.toString(36).padStart(6, '0').slice(-6);
}

export interface NavInstanceHit {
  sectionSlug: string;
  /** null for an instance living in a built-in module's `builtinSections`. */
  sectionId: string | null;
  page: NavPage;
  prefix: string;
  target: string;
  /** Remainder after the two matched segments: '' or starts with '/'. */
  rest: string;
  /** The slug part of the URL differs from the stored slug (client replaces to canonical). */
  slugStale: boolean;
}

/** `/<section>/<slug>~<id>[/rest]` → the instance, or null. Matches the id; the slug is cosmetic. */
export function resolveNavInstance(
  config: NavConfig,
  canonicalPath: string,
): NavInstanceHit | null {
  const path = trimSlash(canonicalPath);
  const [, first, second] = path.split('/');
  if (!first || !second) return null;
  const tilde = second.lastIndexOf('~');
  if (tilde < 0) return null;
  const id = second.slice(tilde + 1);
  const make = (page: NavPage, sectionId: string | null): NavInstanceHit => {
    const prefix = `/${first}/${second}`;
    return {
      sectionSlug: first,
      sectionId,
      page,
      prefix,
      target: page.target,
      rest: path.slice(prefix.length),
      slugStale: second.slice(0, tilde) !== page.slug,
    };
  };
  for (const section of config.sections) {
    if (section.slug !== first) continue;
    const page = section.pages.find((p) => p.id === id);
    if (page) return make(page, section.id);
  }
  const page = config.builtinSections[first]?.find((p) => p.id === id);
  return page ? make(page, null) : null;
}

/** When the URL's slug is stale, the same path with the stored slug; else null. */
export function canonicalInstancePath(config: NavConfig, canonicalPath: string): string | null {
  const hit = resolveNavInstance(config, canonicalPath);
  return hit?.slugStale ? instancePath(hit.sectionSlug, hit.page) + hit.rest : null;
}

function* allInstances(
  config: NavConfig,
): Generator<{ page: NavPage; sectionSlug: string; section: NavSection | null }> {
  for (const section of config.sections)
    for (const page of section.pages) yield { page, sectionSlug: section.slug, section };
  for (const [module, pages] of Object.entries(config.builtinSections))
    for (const page of pages) yield { page, sectionSlug: module, section: null };
}

/** Every `kind: 'main'` entry (hidden or not): target → its instance path. */
export function movedTargets(config: NavConfig): Map<string, string> {
  const out = new Map<string, string>();
  for (const { page, sectionSlug } of allInstances(config))
    if (page.kind === 'main') out.set(page.target, instancePath(sectionSlug, page));
  return out;
}

/** If the path starts (whole segments) with a moved target, the same path under the main. */
export function mainPathFor(config: NavConfig, canonicalPath: string): string | null {
  const path = trimSlash(canonicalPath);
  let best: [string, string] | null = null;
  for (const entry of movedTargets(config)) {
    const [target] = entry;
    if (
      (path === target || path.startsWith(`${target}/`)) &&
      (!best || target.length > best[0].length)
    )
      best = entry;
  }
  return best ? best[1] + path.slice(best[0].length) : null;
}

// ── keys & access ───────────────────────────────────────────────────────

export const pageViewKey = (page: Pick<NavPage, 'id'>): string => `page:${page.id}`;
export const sectionViewKey = (section: Pick<NavSection, 'id'>): string => `section:${section.id}`;
export const builtinPageKey = (pattern: string): string => `page:${pattern}`;

export function navPageKeys(
  config: NavConfig,
): { key: string; sectionKey: string | null; target: string }[] {
  return [...allInstances(config)].map(({ page, section }) => ({
    key: pageViewKey(page),
    sectionKey: section ? sectionViewKey(section) : null,
    target: page.target,
  }));
}

/** The module-view permission string the registry requires for `target` ('pos:view'), or null. */
export function moduleViewFloor(target: string): string | null {
  let best: { pattern: string; perm: string } | null = null;
  for (const rule of ROUTE_ACCESS_RULES) {
    if (rule.match !== 'prefix') continue;
    if (target !== rule.pattern && !target.startsWith(`${rule.pattern}/`)) continue;
    const m = /^permission:([a-z]+):view$/.exec(rule.policyId);
    if (m && (!best || rule.pattern.length > best.pattern.length))
      best = { pattern: rule.pattern, perm: `${m[1]}:view` };
  }
  return best?.perm ?? null;
}

/** The module floor applies until spec 039 guards that module's reads itself. */
export const floorApplies = (target: string): boolean =>
  !DATASET_ENFORCED.includes(moduleOf(target));

export function instanceAllowed(
  page: Pick<NavPage, 'id' | 'target'>,
  permissions: ReadonlySet<string>,
): boolean {
  if (!permissions.has(`${pageViewKey(page)}:view`)) return false;
  const floor = floorApplies(page.target) ? moduleViewFloor(page.target) : null;
  return !floor || permissions.has(floor);
}

/** Member's view: granted instances only; hidden ones only for managers (I8). `builtin` ships as is. */
export function visibleNavConfig(
  config: NavConfig,
  permissions: ReadonlySet<string>,
  canManage: boolean,
): NavConfig {
  const keep = (p: NavPage) =>
    permissions.has(`${pageViewKey(p)}:view`) && (canManage || !p.hidden);
  const sections: NavSection[] = [];
  for (const section of config.sections) {
    if (section.hidden && !canManage) continue;
    const pages = section.pages.filter(keep);
    if (pages.length > 0 || canManage) sections.push({ ...section, pages });
  }
  const builtinSections: Record<string, NavPage[]> = {};
  for (const [module, all] of Object.entries(config.builtinSections)) {
    const pages = all.filter(keep);
    if (pages.length > 0) builtinSections[module] = pages;
  }
  return { version: 1, sections, builtinSections, builtin: config.builtin };
}

// ── validation ──────────────────────────────────────────────────────────

export type NavConfigIssueCode =
  | 'limit'
  | 'slug.format'
  | 'slug.reserved'
  | 'slug.duplicate'
  | 'label.length'
  | 'icon.unknown'
  | 'target.invalid'
  | 'id.invalid'
  | 'main.duplicate'
  | 'kind.invalid'
  | 'section.unknown';
export interface NavConfigIssue {
  code: NavConfigIssueCode;
  path: string[];
  message: string;
}
export interface NavConfigValidationCtx {
  reserved: ReadonlySet<string>;
  targets: ReadonlySet<string>;
}

function iconOk(icon: string): boolean {
  if (icon in PLUGIN_ICON_MAP) return true;
  if (!/^\p{Extended_Pictographic}/u.test(icon)) return false;
  // One emoji = one grapheme (ZWJ sequences like 🧑‍⚕️ are several code points).
  return [...new Intl.Segmenter().segment(icon)].length === 1;
}

export function validateNavConfig(
  config: NavConfig,
  ctx: NavConfigValidationCtx,
): NavConfigIssue[] {
  const issues: NavConfigIssue[] = [];
  const add = (code: NavConfigIssueCode, path: (string | number)[], message: string) =>
    issues.push({ code, path: path.map(String), message });
  const ids = new Set<string>();
  const checkId = (id: string, path: (string | number)[]) => {
    if (!ID_RE.test(id) || ids.has(id))
      add('id.invalid', [...path, 'id'], 'id must be unique, 6 chars a-z0-9');
    ids.add(id);
  };
  const checkLabel = (label: string, path: (string | number)[]) => {
    const l = label.trim();
    if (l.length < 1 || l.length > NAV_LIMITS.label)
      add('label.length', path, `label must be 1..${NAV_LIMITS.label} chars`);
  };
  const checkCommon = (
    node: { slug: string; label: string; icon?: string },
    path: (string | number)[],
  ) => {
    if (!SLUG_RE.test(node.slug)) add('slug.format', [...path, 'slug'], 'invalid slug');
    checkLabel(node.label, [...path, 'label']);
    if (node.icon !== undefined && !iconOk(node.icon))
      add('icon.unknown', [...path, 'icon'], 'unknown icon');
  };
  const mains = new Set<string>();
  const checkPage = (p: NavPage, pp: (string | number)[]) => {
    checkId(p.id, pp);
    checkCommon(p, pp);
    if (p.kind !== 'link' && p.kind !== 'main')
      add('kind.invalid', [...pp, 'kind'], 'invalid kind');
    if (!ctx.targets.has(p.target)) add('target.invalid', [...pp, 'target'], 'invalid target');
    if (p.kind === 'main') {
      if (mains.has(p.target)) add('main.duplicate', [...pp, 'kind'], 'target already has a main');
      mains.add(p.target);
    }
  };

  if (config.sections.length > NAV_LIMITS.sections)
    add('limit', ['sections'], `at most ${NAV_LIMITS.sections} sections`);
  const sectionSlugs = new Set<string>();
  config.sections.forEach((section, si) => {
    const sp = ['sections', si];
    checkId(section.id, sp);
    checkCommon(section, sp);
    if (SLUG_RE.test(section.slug) && ctx.reserved.has(section.slug))
      add('slug.reserved', [...sp, 'slug'], `${section.slug} is reserved`);
    if (sectionSlugs.has(section.slug)) add('slug.duplicate', [...sp, 'slug'], 'duplicate slug');
    sectionSlugs.add(section.slug);
    if (section.pages.length > NAV_LIMITS.pages)
      add('limit', [...sp, 'pages'], `at most ${NAV_LIMITS.pages} pages per section`);
    section.pages.forEach((p, pi) => checkPage(p, [...sp, 'pages', pi]));
  });
  const modules = moduleSegments();
  for (const [module, pages] of Object.entries(config.builtinSections)) {
    const bp = ['builtinSections', module];
    if (!modules.has(module)) add('section.unknown', bp, `unknown module ${module}`);
    if (pages.length > NAV_LIMITS.pages)
      add('limit', bp, `at most ${NAV_LIMITS.pages} pages per section`);
    pages.forEach((p, pi) => checkPage(p, [...bp, pi]));
  }
  for (const [target, o] of Object.entries(config.builtin)) {
    if (!ctx.targets.has(target)) add('target.invalid', ['builtin', target], 'invalid target');
    if (o.label !== undefined) checkLabel(o.label, ['builtin', target, 'label']);
  }
  return issues;
}

/** `{}` / null / garbage reads as the empty config (I7); missing maps and `kind` are defaulted. */
export function normalizeNavConfig(value: unknown): NavConfig {
  const v = value as Partial<NavConfig> | null | undefined;
  if (!v || v.version !== 1 || !Array.isArray(v.sections)) return EMPTY_NAV_CONFIG;
  const page = (p: NavPage): NavPage => ({ ...p, kind: p.kind ?? 'link' });
  return {
    version: 1,
    sections: v.sections.map((s) => ({ ...s, pages: (s.pages ?? []).map(page) })),
    builtinSections: Object.fromEntries(
      Object.entries(v.builtinSections ?? {}).map(([k, pages]) => [k, pages.map(page)]),
    ),
    builtin: v.builtin ?? {},
  };
}

// ── operations (pure: always return a NEW config) ──────────────────────

export type NavDest = { sectionId: string } | { module: string };

export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return /^[a-z]/.test(s) ? s : 'page';
}

const clip = (label: string) => label.trim().slice(0, NAV_LIMITS.label);

function freshId(config: NavConfig): string {
  const used = new Set<string>(config.sections.map((s) => s.id));
  for (const { page } of allInstances(config)) used.add(page.id);
  let id = newId();
  while (used.has(id)) id = newId();
  return id;
}

function listFor(next: NavConfig, dest: NavDest): NavPage[] | null {
  if ('sectionId' in dest) return next.sections.find((s) => s.id === dest.sectionId)?.pages ?? null;
  return (next.builtinSections[dest.module] ??= []);
}

function locate(next: NavConfig, pageId: string): { list: NavPage[]; index: number } | null {
  const lists = [...next.sections.map((s) => s.pages), ...Object.values(next.builtinSections)];
  for (const list of lists) {
    const index = list.findIndex((p) => p.id === pageId);
    if (index >= 0) return { list, index };
  }
  return null;
}

function prune(next: NavConfig): NavConfig {
  for (const [k, v] of Object.entries(next.builtinSections))
    if (v.length === 0) delete next.builtinSections[k];
  for (const [k, v] of Object.entries(next.builtin))
    if (!v.label && !v.hidden) delete next.builtin[k];
  return next;
}

const titleOf = (target: string): string =>
  SCREEN_DESIGN_MANIFEST.find((r) => r.pattern === target)?.title() ??
  target.split('/').pop() ??
  target;

export function addLink(
  config: NavConfig,
  dest: NavDest,
  link: { target: string; label: string; icon?: string },
): NavConfig {
  const next = structuredClone(config);
  const list = listFor(next, dest);
  if (!list) return config;
  const label = clip(link.label);
  list.push({
    id: freshId(config),
    kind: 'link',
    slug: slugify(label),
    label,
    ...(link.icon ? { icon: link.icon } : {}),
    target: link.target,
  });
  return prune(next);
}

/** Link copy next to a source entry, or (for a built-in main) into `builtinSections[module]`. */
export function duplicatePage(
  config: NavConfig,
  ref: { pageId: string } | { target: string; module: string },
): NavConfig {
  const next = structuredClone(config);
  const id = freshId(config);
  if ('pageId' in ref) {
    const at = locate(next, ref.pageId);
    if (!at) return config;
    const { hidden: _hidden, ...src } = at.list[at.index];
    at.list.splice(at.index + 1, 0, { ...src, id, kind: 'link' });
    return next;
  }
  const label = clip(next.builtin[ref.target]?.label ?? titleOf(ref.target));
  (next.builtinSections[ref.module] ??= []).push({
    id,
    kind: 'link',
    slug: slugify(label),
    label,
    target: ref.target,
  });
  return next;
}

/** Move a built-in page's canonical location into a custom section (replaces any previous main). */
export function moveBuiltin(
  config: NavConfig,
  target: string,
  destSectionId: string,
  label: string,
): NavConfig {
  const next = structuredClone(config);
  const dest = next.sections.find((s) => s.id === destSectionId);
  if (!dest) return config;
  const lists = [...next.sections.map((s) => s.pages), ...Object.values(next.builtinSections)];
  for (const list of lists)
    for (let i = list.length - 1; i >= 0; i--)
      if (list[i].kind === 'main' && list[i].target === target) list.splice(i, 1);
  const l = clip(label);
  dest.pages.push({ id: freshId(config), kind: 'main', slug: slugify(l), label: l, target });
  return prune(next);
}

export function movePage(config: NavConfig, pageId: string, dest: NavDest): NavConfig {
  const next = structuredClone(config);
  const at = locate(next, pageId);
  const list = listFor(next, dest);
  if (!at || !list) return config;
  const [page] = at.list.splice(at.index, 1);
  list.push(page);
  return prune(next);
}

export function renamePage(
  config: NavConfig,
  pageId: string,
  patch: { label?: string; slug?: string },
): NavConfig {
  const next = structuredClone(config);
  const at = locate(next, pageId);
  if (!at) return config;
  const page = at.list[at.index];
  if (patch.label !== undefined) page.label = clip(patch.label);
  if (patch.slug !== undefined) page.slug = patch.slug;
  return next;
}

/** `null` deletes the label override. */
export function renameBuiltin(config: NavConfig, target: string, label: string | null): NavConfig {
  const next = structuredClone(config);
  const o = (next.builtin[target] ??= {});
  if (label === null) delete o.label;
  else o.label = clip(label);
  return prune(next);
}

export function renameSection(
  config: NavConfig,
  sectionId: string,
  patch: { label?: string; slug?: string },
): NavConfig {
  const next = structuredClone(config);
  const section = next.sections.find((s) => s.id === sectionId);
  if (!section) return config;
  if (patch.label !== undefined) section.label = clip(patch.label);
  if (patch.slug !== undefined) section.slug = patch.slug;
  return next;
}

/** A link is deleted; a main is restored to its native place. */
export function removePage(config: NavConfig, pageId: string): NavConfig {
  const next = structuredClone(config);
  const at = locate(next, pageId);
  if (!at) return config;
  at.list.splice(at.index, 1);
  return prune(next);
}

export function setHidden(
  config: NavConfig,
  ref: { pageId: string } | { target: string } | { sectionId: string },
  hidden: boolean,
): NavConfig {
  const next = structuredClone(config);
  let node: { hidden?: true } | undefined;
  if ('pageId' in ref) {
    const at = locate(next, ref.pageId);
    node = at?.list[at.index];
  } else if ('sectionId' in ref) node = next.sections.find((s) => s.id === ref.sectionId);
  else node = next.builtin[ref.target] ??= {};
  if (!node) return config;
  if (hidden) node.hidden = true;
  else delete node.hidden;
  return prune(next);
}

export function addSection(config: NavConfig, s: { label: string; slug: string }): NavConfig {
  const next = structuredClone(config);
  next.sections.push({ id: freshId(config), slug: s.slug, label: clip(s.label), pages: [] });
  return next;
}

export function removeSection(config: NavConfig, sectionId: string): NavConfig {
  const next = structuredClone(config);
  next.sections = next.sections.filter((s) => s.id !== sectionId);
  return next;
}
