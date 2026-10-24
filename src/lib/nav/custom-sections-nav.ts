/**
 * Custom nav sections → sidebar / module-mode / switcher shapes (meta spec 037, S3).
 * Pure: reads the member's already-filtered `NavConfig`; never touches `$app`.
 */
import { LayoutGrid } from 'lucide-svelte';
import { getSections, type Section, type SectionItem } from '$lib/components/layout/sections';
import { resolvePluginIcon } from '$lib/plugins/icon-map';
import {
  aliasableTargets,
  instancePath,
  movedTargets,
  reservedSectionSlugs,
  type NavConfig,
  type NavPage,
  type NavSection,
} from './custom-sections';
import { getAreaItems, type AreaId, type ModuleDef, type ModuleNavItem } from './modules';

const own = (href: string) => (p: string) => p === href || p.startsWith(`${href}/`);
const AREAS: AreaId[] = ['pos', 'crm', 'socials', 'scheduling', 'stock', 'finances', 'workforce'];

/** The built-in nav icon for a target screen, or undefined when the target is in no nav. */
export function nativeIconFor(target: string): ModuleNavItem['icon'] | undefined {
  for (const area of AREAS) {
    const hit = getAreaItems(area, { schedulingEnabled: true }).find((i) => i.href === target);
    if (hit) return hit.icon;
  }
  for (const s of getSections()) for (const it of s.items) if (it.href === target) return it.icon;
  return undefined;
}

// NavIcon renders an emoji string as text; icon-map keys resolve to a component.
const isEmoji = (s: string) => /^\p{Extended_Pictographic}/u.test(s);
const pageIcon = (page: NavPage): ModuleNavItem['icon'] =>
  page.icon
    ? isEmoji(page.icon)
      ? page.icon
      : resolvePluginIcon(page.icon)
    : (nativeIconFor(page.target) ?? LayoutGrid);

/** Sections with a usable slug, and the pages in them that are shown and point at a real screen. */
function usable(config: NavConfig): { section: NavSection; pages: NavPage[] }[] {
  if (config.sections.length === 0) return [];
  const reserved = reservedSectionSlugs();
  const targets = new Set(aliasableTargets().map((t) => t.pattern));
  return config.sections
    .filter((s) => !s.hidden && !reserved.has(s.slug))
    .map((section) => ({
      section,
      pages: section.pages.filter((p) => !p.hidden && targets.has(p.target)),
    }))
    .filter(({ pages }) => pages.length > 0);
}

const instanceItem = (slug: string, page: NavPage): ModuleNavItem => {
  const href = instancePath(slug, page);
  return { id: page.id, href, label: page.label, icon: pageIcon(page), matcher: own(href) };
};

export function customSections(config: NavConfig): Section[] {
  return usable(config).map(({ section, pages }) => ({
    id: `custom:${section.id}`,
    label: section.label,
    tone: 'accent' as const,
    items: pages.map((page): SectionItem => {
      const { id: _id, ...item } = instanceItem(section.slug, page);
      return item;
    }),
  }));
}

/** Instances placed into a built-in module's nav. */
export function builtinInstances(config: NavConfig, module: string): ModuleNavItem[] {
  return (config.builtinSections[module] ?? [])
    .filter((p) => !p.hidden)
    .map((page) => instanceItem(module, page));
}

export function customModules(config: NavConfig): ModuleDef[] {
  return usable(config).map(({ section, pages }) => {
    const items = pages.map((page) => instanceItem(section.slug, page));
    const icon = section.icon ? resolvePluginIcon(section.icon) : LayoutGrid;
    return {
      id: `custom:${section.id}`,
      label: section.label,
      icon: typeof icon === 'string' ? LayoutGrid : icon,
      href: items[0].href,
      matcher: (p: string) => p === `/${section.slug}` || p.startsWith(`/${section.slug}/`),
      items,
    };
  });
}

/**
 * Drop moved mains and hidden built-ins, relabel, and (given `module`) append the
 * instances placed into that module. Empty config returns an equal list.
 */
export function applyBuiltinOverrides<T extends { href: string; label: string }>(
  items: T[],
  config: NavConfig,
  module?: string,
): T[] {
  const moved = movedTargets(config);
  const out = items
    .filter((i) => !moved.has(i.href) && !config.builtin[i.href]?.hidden)
    .map((i) => {
      const label = config.builtin[i.href]?.label;
      return label ? { ...i, label } : i;
    });
  const extra = module ? builtinInstances(config, module) : [];
  if (extra.length === 0) return out;
  const group = (out.at(-1) as { group?: string } | undefined)?.group;
  return [...out, ...extra.map((i) => ({ ...i, group }))] as unknown as T[];
}
