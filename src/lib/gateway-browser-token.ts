import { env as publicEnv } from '$env/dynamic/public';

/**
 * Spec 045 switch: `PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN=false` means browsers stop
 * carrying the shared gateway token. Case and stray whitespace (a trailing newline
 * pasted into Vercel) must not silently keep the legacy path.
 */
export function browserSharedTokenOff(): boolean {
  return publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN?.trim().toLowerCase() === 'false';
}
