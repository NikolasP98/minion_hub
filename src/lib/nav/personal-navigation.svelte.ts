import { page } from '$app/state';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { navModuleData } from '$lib/state/ui/nav-mode.svelte';
import { canViewPath } from '$lib/access/can.svelte';
import { visibleModules } from './modules';
import {
  personalNavigation,
  orderPersonalSections,
  type PersonalNavigation,
} from './personal-navigation';

/** A mounted editor exposes its live autosave value; never copy reactive snapshots between owners. */
export const personalEditor = new (class {
  current = $state.raw<{
    owner: string | null;
    token: symbol;
    read: () => PersonalNavigation;
  } | null>(null);
})();
export function personalPreferenceKey(org = page.data.activeOrgId ?? '') {
  return `personalNavigation:${org}`;
}
export function committedPersonalNavigation(): PersonalNavigation {
  const org = page.data.activeOrgId ?? '';
  return personalNavigation(page.data.preferences?.preferences?.[personalPreferenceKey(org)], org);
}
export function personalLayout(): PersonalNavigation {
  const editor = personalEditor.current;
  return editor?.owner === preferenceOwner() ? editor.read() : committedPersonalNavigation();
}
export function personalCatalog() {
  return orderPersonalSections(visibleModules(navModuleData(), canViewPath), personalLayout());
}
export function personalSidebar() {
  const layout = personalLayout();
  return personalCatalog().filter((section) => !layout.hidden.includes(section.id));
}
