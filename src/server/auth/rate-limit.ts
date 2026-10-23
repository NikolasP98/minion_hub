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

// Self observations have event-weighted budgets and a bounded, charged-idle lifecycle.
const observationAttempts = new Map<string, number[]>();
export function checkDecisionEventRateLimit(key: string, weight: number): boolean {
  const now = Date.now();
  for (const [existing, timestamps] of observationAttempts)
    if (!timestamps.length || now - timestamps[timestamps.length - 1] >= 60_000)
      observationAttempts.delete(existing);
  if (!Number.isSafeInteger(weight) || weight < 1 || weight > 20) return false;
  const previous = observationAttempts.get(key);
  if (!previous && observationAttempts.size >= 4096) return false;
  const recent = (previous ?? []).filter((t) => now - t < 60_000);
  // Admission is atomic: denied batches never charge or refresh last-charged time.
  if (recent.length + weight > 120) return false;
  for (let i = 0; i < weight; i++) recent.push(now);
  observationAttempts.set(key, recent);
  return true;
}
