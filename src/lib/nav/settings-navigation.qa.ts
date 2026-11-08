/** QA-only navigation diagnostics served by Vite, outside the product build. */
import { page } from '$app/state';
import { canonicalPath } from '$lib/canonical-path';
import { canViewPath } from '$lib/access/can.svelte';
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import { SettingsReturnMemory } from '$lib/nav/settings-layer';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { ROUTE_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import { patternMatches } from '$lib/routes/route-access-policies';

const calls: unknown[] = [];
const ids = new WeakMap<object, number>();
let nextId = 0;
let installed = false;
function record(memory: object, details: Record<string, unknown>) {
  if (!ids.has(memory)) ids.set(memory, ++nextId);
  if (calls.length < 200)
    calls.push({
      id: ids.get(memory),
      ...details,
      caller: new Error().stack?.split('\n').slice(2, 5),
    });
}
function installTrace() {
  if (installed) return;
  installed = true;
  // Temporary diagnostic wrappers preserve arguments, receiver and results.
  // Remove after the return-context failure is identified (meta Settings follow-up).
  const proto = SettingsReturnMemory.prototype;
  const observe = proto.observe;
  proto.observe = function (this: SettingsReturnMemory, url, owner, settings) {
    record(this, { method: 'observe', href: url.href, owner, settings });
    return observe.call(this, url, owner, settings);
  };
  const reconcile = proto.reconcile;
  proto.reconcile = function (this: SettingsReturnMemory, owner) {
    record(this, { method: 'reconcile', owner });
    return reconcile.call(this, owner);
  };
  const destination = proto.destination;
  proto.destination = function (this: SettingsReturnMemory, ...args) {
    const result = destination.call(this, ...args);
    record(this, { method: 'destination', owner: args[0], origin: args[1], result });
    return result;
  };
}

export function readSettingsNavigation(expectedHref: string) {
  installTrace();
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
    calls: [...calls],
  };
}
