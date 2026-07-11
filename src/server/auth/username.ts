// Pure — no $env/SvelteKit imports, so it's usable from both server code and
// unit tests without runtime shims.

/**
 * lowercase, alnum-edged, 3-32 chars, dots/dashes/underscores in the middle,
 * no '@' (disambiguates a username from an email at login).
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

/** Normalize a raw username: trim + lowercase, then validate the shape. */
export function normalizeUsername(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return USERNAME_RE.test(normalized) ? normalized : null;
}
