import { createAuthClient } from 'better-auth/svelte';
import { jwtClient, organizationClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
	plugins: [jwtClient(), organizationClient()],
});
