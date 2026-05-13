import { createPaperclipClient, type PaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

function baseUrl(): string {
	return env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200';
}

/**
 * Pick the right auth header for the current paperclip identity.
 *
 * Two auth modes are supported:
 *  - Board key (Phase 2, current prod): tokens prefixed `pcli_`. Paperclip's
 *    `server/src/middleware/auth.ts` only accepts these as `Authorization: Bearer <token>`.
 *  - JWT minted via HUB_PAPERCLIP_SHARED_SECRET (legacy/dev): consumed by
 *    paperclip's `middleware/hub-identity.ts` via the `x-hub-identity` header.
 *
 * Sending the wrong header → paperclip 403 "Board access required" and every
 * workforce server-loader returns "paperclip unavailable".
 */
function authHeaders(token: string): Record<string, string> {
	if (token.startsWith('pcli_')) return { Authorization: `Bearer ${token}` };
	return { 'x-hub-identity': token };
}

export function paperclipServerClient(event: RequestEvent): PaperclipClient {
	const token = event.locals.paperclipIdentity?.token;
	if (!token) throw new Error('paperclipIdentity not populated by hooks');
	return createPaperclipClient({
		baseUrl: baseUrl(),
		fetch: globalThis.fetch,
		headers: authHeaders(token),
	});
}

/**
 * Ad-hoc fetch with the same auth headers as paperclipServerClient. Use for
 * endpoints not in the typed client (e.g. mock-only routes during dev).
 */
export async function paperclipRawFetch<T = unknown>(event: RequestEvent, path: string): Promise<T> {
	const token = event.locals.paperclipIdentity?.token;
	if (!token) throw new Error('paperclipIdentity not populated by hooks');
	const r = await fetch(`${baseUrl()}${path}`, {
		headers: authHeaders(token),
	});
	if (!r.ok) {
		const err = new Error(`paperclip ${path} returned ${r.status}`);
		(err as any).status = r.status;
		throw err;
	}
	return (await r.json()) as T;
}
