import { createPaperclipClient, type PaperclipClient } from '@minion-stack/paperclip-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

function baseUrl(): string {
	return env.PAPERCLIP_INTERNAL_URL ?? 'http://paperclip:3200';
}

export function paperclipServerClient(event: RequestEvent): PaperclipClient {
	const token = event.locals.paperclipIdentity?.token;
	if (!token) throw new Error('paperclipIdentity not populated by hooks');
	return createPaperclipClient({
		baseUrl: baseUrl(),
		fetch: globalThis.fetch,
		headers: { 'x-hub-identity': token },
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
		headers: { 'x-hub-identity': token },
	});
	if (!r.ok) {
		const err = new Error(`paperclip ${path} returned ${r.status}`);
		(err as any).status = r.status;
		throw err;
	}
	return (await r.json()) as T;
}
