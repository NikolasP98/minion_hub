import { page } from '$app/state';
import { canonicalPath, localizePath } from '$lib/canonical-path';
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
    const href = memory.destination(preferenceOwner(), page.url.origin, canViewPath, navConfig());
    const target = new URL(href, page.url.origin);
    // Remembered locales are part of the return context. Only canonical
    // destinations, including the direct-entry fallback, need a locale added.
    if (canonicalPath(target.pathname) === target.pathname)
      target.pathname = localizePath(target.pathname);
    return target.pathname + target.search + target.hash;
  },
};
