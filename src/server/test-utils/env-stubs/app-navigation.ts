/**
 * `$app/navigation` stub for vitest — the SvelteKit plugin isn't loaded, so
 * any module that transitively imports it (`$lib/navigation`'s locale-aware
 * `goto` re-export; `$lib/records/peek.svelte`'s `openRecord`/shallow routing)
 * would otherwise fail to resolve. Every export here is a no-op; tests that
 * need to observe a call override with `vi.mock('$app/navigation', …)`.
 */
export const goto = async () => {};
export const invalidate = async () => {};
export const invalidateAll = async () => {};
export const preloadData = async () => ({ type: 'loaded' as const, status: 200, data: {} });
export const preloadCode = async () => {};
export const pushState = () => {};
export const replaceState = () => {};
export const afterNavigate = () => {};
export const beforeNavigate = () => {};
export const onNavigate = () => {};
export const disableScrollHandling = () => {};
