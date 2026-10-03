// This isolated browser artifact has no SvelteKit router. The production page
// still imports its real mutation flow; fixture evidence does not exercise a
// legacy-rule write or claim that a route invalidation occurred.
export async function invalidate(): Promise<void> {}
