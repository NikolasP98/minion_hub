import { QueryClient } from '@tanstack/svelte-query';
import { browser } from '$app/environment';

/**
 * Singleton QueryClient for mutations + client GETs that live outside the
 * SvelteKit load system (gateway-runtime panels/modals, out-of-load dedup).
 *
 * Scope boundary (see specs/2026-07-06-hub-tanstack-query.md §0): never wrap
 * load-gated business pages in this, never route WS-pushed gateway state
 * (agents/sessions/channels/chat/reliability) through it.
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			enabled: browser,
			staleTime: 30_000,
			retry: 1,
			refetchOnWindowFocus: true,
		},
	},
});
