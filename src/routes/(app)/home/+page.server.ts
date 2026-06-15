import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

// Phase 2B PR-2: server load returns identity only. The feed is fetched
// client-side via `getFeedToday()` once the WS connection is up. Server
// loads cannot open per-request WS connections to the gateway; the
// canonical hub pattern (see `src/lib/services/prompt-sections-rpc.ts`)
// is client-side `sendRequest(...)` after mount.

export interface MyAgentIdentity {
	userName: string;
	greeting: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const userName = locals.user.displayName ?? locals.user.email.split('@')[0];
	// Greeting uses the first name only (e.g. "Nikolas", not "Nikolas Sarria").
	const firstName = userName.trim().split(/\s+/)[0] || userName;

	return {
		userName,
		greeting: `Good to see you, ${firstName}.`,
	} satisfies MyAgentIdentity;
};
