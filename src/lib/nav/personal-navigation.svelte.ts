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

export const personalDraft = new (class {
  owner = $state<string | null>(null);
  token: symbol | null = null;
  value = $state.raw<PersonalNavigation | null>(null);
})();
export function personalPreferenceKey(org = page.data.activeOrgId ?? '') {
  return `personalNavigation:${org}`;
}
export function committedPersonalNavigation(): PersonalNavigation {
  const org = page.data.activeOrgId ?? '';
  return personalNavigation(page.data.preferences?.preferences?.[personalPreferenceKey(org)], org);
}
export function personalLayout(): PersonalNavigation {
  return personalDraft.owner === preferenceOwner() && personalDraft.value
    ? personalDraft.value
    : committedPersonalNavigation();
}
export function personalCatalog() {
  return orderPersonalSections(visibleModules(navModuleData(), canViewPath), personalLayout());
}
export function personalSidebar() {
  const layout = personalLayout();
  return personalCatalog().filter((section) => !layout.hidden.includes(section.id));
}
