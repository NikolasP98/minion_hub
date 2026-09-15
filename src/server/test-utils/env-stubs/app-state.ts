/**
 * `$app/state` stub for vitest — the SvelteKit plugin isn't loaded, so any
 * component module that transitively imports it (e.g. `$lib/access/can.svelte`
 * via a POS component) would fail to resolve. Tests that need real values
 * override with `vi.mock('$app/state', …)`.
 */
export const page = {
  data: {} as Record<string, unknown>,
  params: {} as Record<string, string>,
  url: new URL('http://localhost/'),
  route: { id: null as string | null },
  status: 200,
  error: null,
  form: null,
  state: {},
};
export const navigating = { from: null, to: null, type: null, complete: Promise.resolve() };
export const updated = { current: false, check: async () => false };
