/**
 * Vitest stub for SvelteKit's `$app/environment` virtual module (no sveltekit
 * vite plugin under vitest — see the `$env/*` stubs alongside this file).
 * Tests run under Node by default (no `window`), so `browser` is false.
 */
export const browser = false;
export const dev = true;
export const building = false;
export const version = 'test';
