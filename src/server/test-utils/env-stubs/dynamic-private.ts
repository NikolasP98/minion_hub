/**
 * Vitest stub for SvelteKit's `$env/dynamic/private` virtual module.
 * Aliased in vitest.config.ts. Reads from process.env so test-utils/setup.ts
 * defaults (TURSO_DB_URL, B2_*, …) flow through. Individual tests can still
 * `vi.mock('$env/dynamic/private', …)` to override with fixed values.
 */
export const env: Record<string, string | undefined> = process.env;
