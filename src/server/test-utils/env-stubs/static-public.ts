/**
 * Vitest stub for SvelteKit's `$env/static/public` virtual module.
 * SvelteKit emits these as named exports at build time; vitest can't resolve
 * the virtual module, so we provide harmless test defaults here.
 */
export const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
export const PUBLIC_SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key';
export const PUBLIC_POSTHOG_KEY = process.env.PUBLIC_POSTHOG_KEY ?? '';
export const PUBLIC_POSTHOG_HOST = process.env.PUBLIC_POSTHOG_HOST ?? '';
