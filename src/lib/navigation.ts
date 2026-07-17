/**
 * Drop-in replacement for `$app/navigation` with a locale-aware `goto`.
 *
 * With `prefixDefaultLanguage: 'always'` every page URL carries its locale
 * (`/en/...`, `/es/...`). Anchor hrefs are rewritten by <ParaglideJS>, but
 * programmatic `goto('/pos/sell')` would land on the unprefixed URL (the
 * reroute hook still resolves it, so the page works — but the locale vanishes
 * from the address bar). Import `goto` from here instead of `$app/navigation`
 * to keep the prefix. Everything else re-exports unchanged.
 */
export * from '$app/navigation';
import { goto as kitGoto } from '$app/navigation';
import { localizePath } from '$lib/canonical-path';

export const goto: typeof kitGoto = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
    // route() first so an already-prefixed target can't double-prefix.
    return kitGoto(localizePath(url), opts);
  }
  if (url instanceof URL && typeof location !== 'undefined' && url.origin === location.origin) {
    const localized = new URL(url);
    localized.pathname = localizePath(url.pathname);
    return kitGoto(localized, opts);
  }
  return kitGoto(url, opts);
};
