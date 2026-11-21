/**
 * A same-origin return path (`/path?query#hash`) from untrusted input, or null. Parsed against
 * the origin, so a tab or newline the browser would strip (`/\t/evil.com` is `//evil.com`) is
 * caught by the origin comparison.
 */
export function normalizeLoginRedirect(requested: string | null, origin: string): string | null {
  if (
    !requested ||
    !requested.startsWith('/') ||
    requested.startsWith('//') ||
    requested.includes('\\') ||
    requested === '/'
  )
    return null;
  try {
    const normalized = new URL(requested, origin);
    return normalized.origin === origin
      ? `${normalized.pathname}${normalized.search}${normalized.hash}`
      : null;
  } catch {
    return null;
  }
}
