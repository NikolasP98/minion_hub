import { json, type RequestHandler } from '@sveltejs/kit';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { publicBase } from '$server/mcp/base-url';
import { exchangeCode, pruneOauth, refresh } from '$server/mcp/oauth.service';
import { resourceMatches } from '$server/mcp/oauth-logic';

// Token endpoint (RFC 6749 §3.2, spec 143): form-encoded (JSON also accepted), public clients,
// PKCE S256. Every answer is JSON with `cache-control: no-store`; no secret is ever logged.
const PER_MINUTE = 60;
const MAX_BODY_CHARS = 8 * 1024;
const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

type ErrorCode = 'invalid_request' | 'invalid_grant' | 'invalid_target' | 'unsupported_grant_type';
const fail = (error: ErrorCode) => json({ error }, { status: 400, headers: NO_STORE });

async function readParams(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    if ((request.headers.get('content-type') ?? '').includes('json')) {
      const body = JSON.parse(text);
      return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    }
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let ip = 'unknown';
  try {
    ip = getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!(await checkSharedRateLimit(`mcp-token:${ip}`, PER_MINUTE)))
    return json(
      { error: 'too_many_requests' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': '60' } },
    );

  const p = await readParams(request);
  if (!p) return fail('invalid_request');
  const str = (k: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : null);
  if (
    p.resource !== undefined &&
    !(typeof p.resource === 'string' && resourceMatches(p.resource, publicBase()))
  )
    return fail('invalid_target');

  const clientId = str('client_id');
  let pair = null;
  if (p.grant_type === 'authorization_code') {
    const [code, verifier, redirectUri] = [str('code'), str('code_verifier'), str('redirect_uri')];
    if (!clientId || !code || !verifier || !redirectUri) return fail('invalid_request');
    pair = await exchangeCode({ code, clientId, redirectUri, verifier });
  } else if (p.grant_type === 'refresh_token') {
    const token = str('refresh_token');
    if (!clientId || !token) return fail('invalid_request');
    pair = await refresh({ token, clientId });
  } else return fail('unsupported_grant_type');

  // Housekeeping on about 1% of calls; a failure never affects the answer.
  if (Math.random() < 0.01) void pruneOauth().catch(() => {});
  return pair ? json(pair, { headers: NO_STORE }) : fail('invalid_grant');
};
