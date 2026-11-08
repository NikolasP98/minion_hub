/** Read-only QA diagnostics served by Vite, outside the product build. */
import { page } from '$app/state';
import { canonicalPath } from '$lib/canonical-path';
import { canViewPath } from '$lib/access/can.svelte';
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { ROUTE_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import { patternMatches } from '$lib/routes/route-access-policies';

export function readSettingsNavigation(expectedHref: string) {
  const expected = new URL(expectedHref, page.url.origin);
  return {
    url: page.url.href,
    status: page.status,
    error: page.error?.message ?? null,
    owner: preferenceOwner(),
    ownerParts: {
      actorType: typeof page.data.user?.id,
      actorPresent: Boolean(page.data.user?.id),
      orgType: typeof page.data.activeOrgId,
      orgPresent: Boolean(page.data.activeOrgId),
    },
    isSettings: settingsLayer.isOpen,
    back: settingsLayer.returnHref(),
    expectedAllowed: canViewPath(canonicalPath(expected.pathname) + expected.search),
    expectedKnown: ROUTE_DESIGN_MANIFEST.some(
      (route) =>
        !route.pattern.startsWith('/[') &&
        patternMatches(route.pattern, canonicalPath(expected.pathname)),
    ),
  };
}
