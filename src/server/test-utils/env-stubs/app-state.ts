/**
 * Vitest stub for SvelteKit's `$app/state` virtual module (no sveltekit vite
 * plugin under vitest — see the `$env/*` and `$app/environment` stubs
 * alongside this file).
 *
 * Needed the moment a test MOUNTS a component that reaches
 * `$lib/components/ui`: that barrel transitively imports
 * `$lib/access/can.svelte.ts`, which reads `page.data`. A per-test
 * `vi.mock('$app/state', …)` is enough when the importer is loaded directly
 * (can.svelte.test.ts), but not when the import is discovered while Vite
 * transforms a `.svelte` component graph — that resolution happens before any
 * mock registry is consulted, so the module has to exist.
 *
 * Deliberately inert: `page.data` is empty, so a permission-gated component
 * renders its denied state unless the test overrides this with `vi.mock`,
 * which still wins (same contract as the `$env/*` stubs).
 */
export const page = {
  data: {} as Record<string, unknown>,
  url: new URL('http://localhost/'),
  params: {} as Record<string, string>,
  route: { id: null as string | null },
  status: 200,
  error: null,
  form: null,
  state: {} as Record<string, unknown>,
};

export const navigating = { from: null, to: null, type: null, willUnload: false, delta: null };
export const updated = { current: false, check: async () => false };
