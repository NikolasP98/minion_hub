import { createI18n } from '@inlang/paraglide-sveltekit';
import * as runtime from '$lib/paraglide/runtime';

export const i18n = createI18n(runtime, {
  // Locale is always visible in the URL: /en/... and /es/... both prefixed.
  // Unprefixed page URLs 302 to the negotiated locale (cookie → accept-language
  // → default) via i18n.handle().
  prefixDefaultLanguage: 'always',
  // Non-page surfaces must NEVER be language-redirected: a 302 on an API POST
  // downgrades it to GET, and the gateway resolves JWKS at /.well-known.
  exclude: [/^\/api(\/|$)/, /^\/ingest(\/|$)/, /^\/\.well-known(\/|$)/],
});

