// ponytail: global in-memory limiter, one process, per-lambda; move to Valkey
// if abuse ever matters. Used by the unauthenticated password-login and
// forgot-password endpoints — the only rung 7-worthy option since neither
// endpoint has a session/tenant to key off, and a Map is smaller than pulling
// in a rate-limit dependency for 5-requests-per-minute.
const WINDOW_MS = 60_000;
const LIMIT = 5;

const attempts = new Map<string, number[]>();

/** Returns true if `key` is still under the limit (and records this attempt). */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}
