import { error } from '@sveltejs/kit';
import { authHeaders, baseUrl } from '$lib/server/workforce-fetch';
import { hubBaseUrl } from '$server/config/urls';
import type { RequestHandler } from './$types';

const HOP_BY_HOP = new Set(['cookie', 'host', 'connection', 'content-length', 'transfer-encoding', 'te', 'trailer', 'upgrade']);

const handler: RequestHandler = async ({ request, params, locals, url }) => {
	const identity = locals.workforceIdentity;
	if (!identity) throw error(401, 'unauthenticated');

	const target = new URL(`${baseUrl()}/api/${params.path ?? ''}`);
	for (const [k, v] of url.searchParams) target.searchParams.set(k, v);

	const forwardedHeaders: Record<string, string> = {};
	for (const [k, v] of request.headers.entries()) {
		if (!HOP_BY_HOP.has(k.toLowerCase())) {
			forwardedHeaders[k] = v;
		}
	}
	// Board keys (pcli_) authenticate via Authorization: Bearer; only minted
	// JWTs go through x-hub-identity — same split as workforceServerClient.
	Object.assign(forwardedHeaders, authHeaders(identity.token));
	// Preserve the canonical public proxy boundary for Workforce's mutation
	// origin guard. Never derive this trust signal from the inbound Host header.
	const publicHub = new URL(hubBaseUrl());
	forwardedHeaders['x-forwarded-host'] = publicHub.host;
	forwardedHeaders['x-forwarded-proto'] = publicHub.protocol.slice(0, -1);

	const init: RequestInit = {
		method: request.method,
		headers: forwardedHeaders,
	};
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = await request.arrayBuffer();
	}

	const upstream = await fetch(target.toString(), init);
	return new Response(upstream.body, {
		status: upstream.status,
		headers: upstream.headers,
	});
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
