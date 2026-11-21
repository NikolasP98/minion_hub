import { json, type RequestHandler } from '@sveltejs/kit';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { registerClient } from '$server/mcp/oauth.service';
import { cleanAppName, isLoopbackRedirect } from '$server/mcp/oauth-logic';

// Dynamic client registration (RFC 7591) for public apps whose every return address is on the
// person's own machine (spec 143 D11). No client secret exists; the approval screen names the
// app, so registration grants nothing by itself.
const PER_HOUR = 10;
const MAX_BODY_CHARS = 8 * 1024;

const invalid = (error: 'invalid_redirect_uri' | 'invalid_client_metadata') =>
  json({ error }, { status: 400, headers: { 'cache-control': 'no-store' } });

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let ip = 'unknown';
  try {
    ip = getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!(await checkSharedRateLimit(`mcp-register:${ip}`, PER_HOUR, 3_600_000)))
    return json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'retry-after': '3600' } },
    );

  const text = await request.text();
  let body: { client_name?: unknown; redirect_uris?: unknown } | null = null;
  try {
    body = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const name = typeof body?.client_name === 'string' ? cleanAppName(body.client_name) : '';
  if (!name || name.length > 80) return invalid('invalid_client_metadata');
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5)
    return invalid('invalid_redirect_uri');
  if (!uris.every(isLoopbackRedirect)) return invalid('invalid_redirect_uri');

  const { id } = await registerClient(name, [...new Set(uris)], ip);
  return json(
    {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
};
