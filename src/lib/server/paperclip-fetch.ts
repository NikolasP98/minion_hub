import { createPaperclipClient, type PaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

function baseUrl(): string {
	return env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200';
}

/**
 * Paperclip accepts two distinct auth modes that travel on different headers:
 *   - Board keys (token starts with `pcli_`): must be sent via
 *     `Authorization: Bearer <token>` (paperclip's auth.ts rejects them on
 *     `x-hub-identity`).
 *   - JWT identity mints (everything else): sent via `x-hub-identity: <token>`.
 * See memory `reference_hub_paperclip_auth_header_split` for the original
 * surface of this bug (2026-05-12).
 */
function authHeaders(token: string): Record<string, string> {
	return token.startsWith('pcli_')
		? { Authorization: `Bearer ${token}` }
		: { 'x-hub-identity': token };
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
