/** Model SvelteKit's reactive page object in mounted collection-route tests. */
export function reactivePage<T extends object>(initial: T): T {
  const state = $state(initial);
  return state;
}
