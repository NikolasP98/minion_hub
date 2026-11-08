import { page } from '$app/state';
import { canViewPath } from '$lib/access/can.svelte';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { navConfig, navPath } from './nav-config.svelte';
import { isSettingsDestination, SettingsReturnMemory } from './settings-layer';

const memory = new SettingsReturnMemory();

export const settingsLayer = {
  get isOpen() {
    return isSettingsDestination(navPath());
  },
  reconcile() {
    memory.reconcile(preferenceOwner());
  },
  observe() {
    const owner = preferenceOwner();
    memory.reconcile(owner);
    if (page.status >= 400 || page.error) return;
    memory.observe(page.url, owner, this.isOpen);
  },
  returnHref() {
    // A real link keeps SvelteKit's dirty-form guard and browser modifiers.
    return memory.destination(preferenceOwner(), page.url.origin, canViewPath, navConfig());
  },
};
