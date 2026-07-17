import { availableLanguageTags, languageTag } from '$lib/paraglide/runtime';

/**
 * Strip the locale segment from a localized pathname (`/es/pos/sell` →
 * `/pos/sell`). ALL pathname comparisons — route guards, nav active-state,
 * RBAC path checks — must run on the canonical path, never on raw
 * `url.pathname`, because SvelteKit's reroute hook only affects route
 * matching, not `event.url`/`page.url`.
 *
 * Deliberately dependency-free (paraglide runtime only): importing
 * `$lib/i18n` pulls the whole @inlang/paraglide-sveltekit package (Svelte
 * components, $app/stores) into every consumer, which breaks vitest suites.
 * The hub defines no pathname translations, so canonicalization is exactly a
 * prefix strip — equivalent to `i18n.route()`.
 */
export function canonicalPath(pathname: string): string {
  const seg = pathname.split('/')[1];
  if ((availableLanguageTags as readonly string[]).includes(seg)) {
    return pathname.slice(seg.length + 1) || '/';
  }
  return pathname;
}

/** Prefix a canonical path with a locale (`/pos/sell` → `/es/pos/sell`). */
export function localizePath(pathname: string, lang: string = languageTag()): string {
  const canonical = canonicalPath(pathname);
  return `/${lang}${canonical === '/' ? '' : canonical}`;
}
