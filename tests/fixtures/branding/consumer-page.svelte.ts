import type { Branding } from '$lib/branding';

/** Request-owned SvelteKit page replacement for the actual consumer renders. */
export const consumerPage = $state({
  data: { branding: undefined as Branding | undefined },
  url: new URL('http://localhost/'),
  params: {},
});
