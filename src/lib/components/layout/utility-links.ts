import { Activity, Store, Cloud, Power } from 'lucide-svelte';
import * as m from '$lib/paraglide/messages';
import type { Section } from './sections';

/** One ordered offer list for desktop and mobile; authority stays in canViewPath. */
export function utilityLinks(canViewPath: (href: string) => boolean) {
  return [
    { href: '/reliability', label: m.nav_reliability(), icon: Activity },
    { href: '/marketplace', label: m.nav_marketplace(), icon: Store },
    { href: '/cloud', label: m.nav_cloud(), icon: Cloud },
    { href: '/killswitches', label: m.nav_killSwitches(), icon: Power },
  ].filter((item) => canViewPath(item.href));
}

/** A section heading must not reveal an otherwise entirely unavailable group. */
export function hasVisibleSectionItems(section: Section, canViewPath: (href: string) => boolean) {
  return (
    section.items.some((item) => canViewPath(item.href)) ||
    (section.subsections ?? []).some((sub) => sub.items.some((item) => canViewPath(item.href)))
  );
}
