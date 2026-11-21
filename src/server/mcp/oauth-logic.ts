/**
 * Pure helpers of the hub's minimal OAuth 2.1 authorization server (spec 143): loopback
 * return addresses, PKCE S256, opaque secrets and the two discovery documents.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SECRET_PREFIX = { code: 'mcp_ac_', access: 'mcp_at_', refresh: 'mcp_rt_' } as const;
export const MCP_PATH = '/api/mcp';

// The raw text is checked as well as the parsed URL: `new URL` rewrites `127.1` to 127.0.0.1 and
// lowercases `LOCALHOST`, and neither is an address the spec registers.
const LOOPBACK_RAW = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?([/?]|$)/;
const MAX_URI_LENGTH = 200;

const parse = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** `http` on this machine only (exactly localhost, 127.0.0.1 or [::1]), any port, no credentials, no fragment. */
export function isLoopbackRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URI_LENGTH || value.includes('#'))
    return false;
  if (!LOOPBACK_RAW.test(value)) return false;
  const url = parse(value);
  return (
    !!url &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}

/** A requested address matches a registered one exactly, or on a loopback address ignoring the port. */
export function redirectMatches(requested: string, registered: readonly string[]): boolean {
  if (!isLoopbackRedirect(requested)) return false;
  if (registered.includes(requested)) return true;
  const a = new URL(requested);
  return registered.some((r) => {
    if (!isLoopbackRedirect(r)) return false;
    const b = new URL(r);
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  });
}

const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;

/** RFC 7636 S256: base64url(sha256(verifier)) equals the challenge. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const newSecret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const newClientId = () => 'mcpc_' + randomBytes(18).toString('base64url');

export const protectedResourceUrl = (base: string) =>
  `${base}/.well-known/oauth-protected-resource${MCP_PATH}`;

/** `base` is the configured public hub URL without a trailing slash (`publicBase()`), never the request origin. */
export function metadata(base: string) {
  return {
    protectedResource: {
      resource: `${base}${MCP_PATH}`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
    },
    authorizationServer: {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
      // TODO(handoff): Client ID Metadata Documents (CIMD) are not supported; harnesses that
      // need them fall back to registration. Add if a target harness drops dynamic registration.
    },
  };
}

/** The discovery document served at an exact `/.well-known/` path, or null. */
export function wellKnownDocument(pathname: string, base: string): object | null {
  const docs = metadata(base);
  if (
    pathname === `/.well-known/oauth-protected-resource${MCP_PATH}` ||
    pathname === '/.well-known/oauth-protected-resource'
  )
    return docs.protectedResource;
  if (pathname === '/.well-known/oauth-authorization-server') return docs.authorizationServer;
  return null;
}

const norm = (value: string) => {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
};

/** An RFC 8707 `resource` is the MCP endpoint of this hub, compared after URL normalisation. */
export const resourceMatches = (resource: string, base: string) =>
  norm(resource) !== null && norm(resource) === norm(`${base}${MCP_PATH}`);

/** Strip control and bidirectional-format characters from an app-chosen name. */
export const cleanAppName = (name: string) => name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
