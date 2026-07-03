import { createWorkforceClient, type WorkforceClient } from '@minion-stack/workforce-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { mintWorkforceIdentity } from './workforce-identity';

/**
 * Base URL of the Workforce backend. `WORKFORCE_INTERNAL_URL` is the canonical
 * name; `PAPERCLIP_INTERNAL_URL` is read as a compat fallback during the
 * paperclip→workforce rename so the env cutover has no outage window.
 */
export function baseUrl(): string {
	return env.WORKFORCE_INTERNAL_URL ?? env.PAPERCLIP_INTERNAL_URL ?? 'http://workforce:3200';
}

/**
 * Pick the right auth header for the current workforce identity.
 *
 * Two auth modes are supported:
 *  - Board key (current prod): tokens prefixed `pcli_`. The Workforce backend's
 *    `server/src/middleware/auth.ts` only accepts these as `Authorization: Bearer <token>`.
 *  - JWT minted via HUB_WORKFORCE_SHARED_SECRET (legacy/dev): consumed by
 *    the backend's `middleware/hub-identity.ts` via the `x-hub-identity` header.
 *
 * Sending the wrong header → backend 403 "Board access required" and every
 * workforce server-loader returns "workforce unavailable". See memory
 * `reference_hub_paperclip_auth_header_split` — the fix has regressed once
 * across a merge boundary (2026-05-12 → re-applied 2026-05-13 PR #43).
 */
function authHeaders(token: string): Record<string, string> {
	return token.startsWith('pcli_')
		? { Authorization: `Bearer ${token}` }
		: { 'x-hub-identity': token };
}

export function workforceServerClient(event: RequestEvent): WorkforceClient {
	const token = event.locals.workforceIdentity?.token;
	if (!token) throw new Error('workforceIdentity not populated by hooks');
	return createWorkforceClient({
		baseUrl: baseUrl(),
		fetch: globalThis.fetch,
		headers: authHeaders(token),
	});
}

/**
 * Ad-hoc fetch with the same auth headers as workforceServerClient. Use for
 * endpoints not in the typed client (e.g. mock-only routes during dev).
 */
export async function workforceRawFetch<T = unknown>(
	event: RequestEvent,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const token = event.locals.workforceIdentity?.token;
	if (!token) throw new Error('workforceIdentity not populated by hooks');
	const headers: Record<string, string> = { ...authHeaders(token) };
	if (init?.body) headers['content-type'] = 'application/json';
	const r = await fetch(`${baseUrl()}${path}`, {
		...init,
		headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
	});
	if (!r.ok) {
		const err = new Error(`workforce ${path} returned ${r.status}`);
		(err as any).status = r.status;
		throw err;
	}
	return (await r.json()) as T;
}

/**
 * A workforce client for use OUTSIDE a request (e.g. the projects-module task
 * dispatcher). Prefers the board key (prod auth mode); otherwise mints a short
 * hub-identity JWT scoped to the org. Either header is selected by authHeaders.
 * Throws if neither HUB_WORKFORCE_BOARD_KEY nor the mint secret is available —
 * callers treat dispatch as best-effort and swallow.
 */
export async function workforceClientForOrg(
	orgId: string,
	actor?: { id?: string | null; name?: string | null; email?: string | null },
): Promise<WorkforceClient> {
	// Same board-key fallback chain the hooks use (hooks.server workforceIdentityHandle):
	// prod is configured with the compat HUB_PAPERCLIP_BOARD_KEY name, so checking
	// only HUB_WORKFORCE_BOARD_KEY found nothing and fell back to a mint secret that
	// isn't set — the bug that made the sync + dispatch silently no-op.
	const boardKey = (env.HUB_WORKFORCE_BOARD_KEY ?? env.HUB_PAPERCLIP_BOARD_KEY)?.trim();
	// Mint as the REAL acting user (matching the per-request identity the hooks
	// mint for /workforce pages) — the backend authorizes the company-scoped
	// endpoints against a known board member, so a synthetic 'system' user is
	// rejected. Falls back to 'system' only when no actor is supplied.
	const token =
		boardKey && boardKey.length > 0
			? boardKey
			: await mintWorkforceIdentity({
					userId: actor?.id ?? 'system',
					email: actor?.email ?? null,
					name: actor?.name ?? 'Projects',
					companyId: orgId,
				});
	return createWorkforceClient({ baseUrl: baseUrl(), fetch: globalThis.fetch, headers: authHeaders(token) });
}
