// ponytail: global in-memory limiter, one process, per-lambda; move to Valkey
// if abuse ever matters. Used by unauthenticated/high-traffic endpoints with
// no session/tenant to key off, and a Map is smaller than pulling in a
// rate-limit dependency. Default 5/min is the password-auth endpoints'
// (login/forgot-password); other callers pass their own limit/windowMs.
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 5;

const attempts = new Map<string, number[]>();

/** Returns true if `key` is still under `limit` requests per `windowMs` (and records this attempt). */
export function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}
