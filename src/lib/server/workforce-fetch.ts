import { createPaperclipClient, type PaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Base URL of the Workforce backend. `WORKFORCE_INTERNAL_URL` is the canonical
 * name; `PAPERCLIP_INTERNAL_URL` is read as a compat fallback during the
 * paperclip→workforce rename so the env cutover has no outage window.
 */
function baseUrl(): string {
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

export function workforceServerClient(event: RequestEvent): PaperclipClient {
	const token = event.locals.workforceIdentity?.token;
	if (!token) throw new Error('workforceIdentity not populated by hooks');
	return createPaperclipClient({
		baseUrl: baseUrl(),
		fetch: globalThis.fetch,
		headers: authHeaders(token),
	});
}

/**
 * Ad-hoc fetch with the same auth headers as workforceServerClient. Use for
 * endpoints not in the typed client (e.g. mock-only routes during dev).
 */
export async function workforceRawFetch<T = unknown>(event: RequestEvent, path: string): Promise<T> {
	const token = event.locals.workforceIdentity?.token;
	if (!token) throw new Error('workforceIdentity not populated by hooks');
	const r = await fetch(`${baseUrl()}${path}`, {
		headers: authHeaders(token),
	});
	if (!r.ok) {
		const err = new Error(`workforce ${path} returned ${r.status}`);
		(err as any).status = r.status;
		throw err;
	}
	return (await r.json()) as T;
}
