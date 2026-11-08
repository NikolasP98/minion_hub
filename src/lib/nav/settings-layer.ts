import { canonicalPath } from '$lib/canonical-path';
import { EMPTY_NAV_CONFIG, resolveNavInstance, type NavConfig } from './custom-sections';
import { ROUTE_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import { patternMatches } from '$lib/routes/route-access-policies';

export function isSettingsDestination(href: string, config: NavConfig = EMPTY_NAV_CONFIG): boolean {
  const path = canonicalPath(new URL(href, 'https://navigation.invalid').pathname);
  const target = resolveNavInstance(config, path)?.target ?? path;
  return target === '/settings' || target.startsWith('/settings/');
}

/** Session-only return context. Reads are pure; a cancelled navigation never consumes it. */
export class SettingsReturnMemory {
  #owner: string | null = null;
  #href: string | null = null;
  #origin: string | null = null;

  reconcile(owner: string | null) {
    if (owner === this.#owner) return;
    this.#owner = owner;
    this.#href = null;
    this.#origin = null;
  }

  observe(url: URL, owner: string | null, settings: boolean) {
    this.reconcile(owner);
    if (owner && !settings) {
      this.#href = url.pathname + url.search + url.hash;
      this.#origin = url.origin;
    }
  }

  destination(
    owner: string | null,
    origin: string,
    canView: (href: string) => boolean,
    config: NavConfig = EMPTY_NAV_CONFIG,
  ): string {
    const fallback = '/account/home';
    if (!owner || owner !== this.#owner || !this.#href || this.#origin !== origin) return fallback;
    const url = new URL(this.#href, origin);
    const path = canonicalPath(url.pathname);
    const instance = resolveNavInstance(config, path);
    const target = instance ? instance.target + instance.rest : path;
    const known = ROUTE_DESIGN_MANIFEST.some(
      (route) => !route.pattern.startsWith('/[') && patternMatches(route.pattern, target),
    );
    if (
      url.origin !== origin ||
      !known ||
      /^\/(?:api|login|register|auth)(?:\/|$)/.test(path) ||
      isSettingsDestination(url.href, config) ||
      !canView(path + url.search)
    )
      return fallback;
    return this.#href;
  }
}
