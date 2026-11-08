/** Read-only browser diagnostics served by Vite to the loopback QA smoke. */
import { page } from '$app/state';
import { canonicalPath } from '$lib/canonical-path';
import { canViewPath } from '$lib/access/can.svelte';
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';

export function readSettingsNavigation(expectedHref: string) {
  const expected = new URL(expectedHref, page.url.origin);
  return {
    url: page.url.href,
    status: page.status,
    error: page.error?.message ?? null,
    owner: preferenceOwner(),
    isSettings: settingsLayer.isOpen,
    back: settingsLayer.returnHref(),
    expectedAllowed: canViewPath(canonicalPath(expected.pathname) + expected.search),
  };
}
