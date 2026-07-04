/**
 * HMAC-signed OAuth `state` for the Meta broker (spec §5,
 * 2026-07-04-meta-business-integration). Same shape as the
 * channel-claim HMAC pattern (`identity/channel-claim.service.ts`): keyed
 * hash, constant-time compare, no server-side store.
 *
 * The signed token is set as BOTH the httpOnly `state` cookie and the
 * `state` query param handed to Meta's `dialog/oauth`. Verification checks
 * token === cookie (single round-trip binding — the redirect can't be
 * replayed once the route clears the cookie), the HMAC signature (tamper
 * detection), and token age (expiry). `nonce` adds per-request entropy so
 * two consecutive connects for the same org/user never produce the same
 * token; it is not tracked server-side (see `mismatch` below).
 *
 * ponytail: no nonce-store table — the cookie itself is the single-use
 * token (cleared by the callback route after one use). A stolen callback
 * URL replayed without the cookie fails on `mismatch`. Add a durable
 * nonce store only if the cookie-binding stops being enough (e.g. state
 * needs to survive across devices).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStatePayload = { org: string; userId: string; nonce: string; ts: number };

function stateSecret(): string {
  return env.META_APP_SECRET || env.ENCRYPTION_KEY || env.BETTER_AUTH_SECRET || 'dev-meta-oauth-state-secret';
}

function sign(body: string): string {
  return createHmac('sha256', stateSecret()).update(body).digest('base64url');
}

/** Build a fresh signed state token for org+user. */
export function signOAuthState(input: { org: string; userId: string }): string {
  const payload: OAuthStatePayload = {
    org: input.org,
    userId: input.userId,
    nonce: randomBytes(12).toString('base64url'),
    ts: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export type VerifyOAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: 'mismatch' | 'malformed' | 'signature' | 'expired' };

/**
 * Verify the `state` query param against the cookie value that was set when
 * the flow started. Both must be present and identical, then the signature
 * and age are checked.
 */
export function verifyOAuthState(
  stateParam: string | null | undefined,
  cookieValue: string | null | undefined,
): VerifyOAuthStateResult {
  if (!stateParam || !cookieValue || stateParam !== cookieValue) return { ok: false, reason: 'mismatch' };

  const [body, sig] = stateParam.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.ts !== 'number' || Date.now() - payload.ts > OAUTH_STATE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
