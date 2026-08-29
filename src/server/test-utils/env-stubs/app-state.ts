/**
 * Vitest stub for SvelteKit's `$app/state` virtual module (no sveltekit vite
 * plugin under vitest — see the `$env/*` and `$app/environment` stubs alongside
 * this file). Components read `page.data.*` for org context; the defaults here
 * are the empty ones. A test that needs specific values overrides with
 * `vi.mock('$app/state', ...)`, which now resolves because this alias exists.
 */
export const page = {
  data: {} as Record<string, unknown>,
  url: new URL('http://localhost/'),
  params: {} as Record<string, string>,
  route: { id: null as string | null },
  status: 200,
  error: null,
  form: undefined as unknown,
  state: {} as Record<string, unknown>,
};
export const navigating = { from: null, to: null, type: null, willUnload: false };
export const updated = { current: false, check: async () => false };
