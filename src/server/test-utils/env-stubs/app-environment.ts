/**
 * Vitest stub for SvelteKit's `$app/environment`. Provided by the SvelteKit
 * plugin in real builds; absent under vitest. Pulled in transitively now that
 * `*.remote.ts` modules import server services (e.g. posthog) that read it.
 */
export const browser = false;
export const building = false;
export const dev = false;
export const version = 'test';
