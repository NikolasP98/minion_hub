/** QA-only navigation diagnostics served by Vite, outside the product build. */
import { page } from '$app/state';
import { canonicalPath } from '$lib/canonical-path';
import { canViewPath } from '$lib/access/can.svelte';
import { settingsLayer } from '$lib/nav/settings-layer.svelte';
import { SettingsReturnMemory } from '$lib/nav/settings-layer';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';

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
    isSettings: settingsLayer.isOpen,
    back: settingsLayer.returnHref(),
    expectedAllowed: canViewPath(canonicalPath(expected.pathname) + expected.search),
    calls: [...calls],
  };
}
