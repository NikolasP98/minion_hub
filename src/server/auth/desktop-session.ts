/**
 * Desktop session persistence — works around CEF incognito mode (Electrobun #278).
 *
 * CEF on Linux fails to create a persistent profile due to a partition path
 * nesting bug, falling back to off-the-record mode where cookies vanish
 * between navigations. This module stores session cookies server-side in a
 * JSON file so hooks.server.ts can re-inject them into requests that arrive
 * without cookies.
 *
 * Only used when DESKTOP=1.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_FILE = join(process.cwd(), 'data', 'desktop-session.json');

/** Persist auth cookie string (e.g. "better-auth.session_token=abc123") to disk. */
export function saveDesktopCookies(cookieString: string): void {
  writeFileSync(SESSION_FILE, JSON.stringify({ cookies: cookieString, ts: Date.now() }));
}

/** Load previously-stored auth cookies, or null if none. */
export function loadDesktopCookies(): string | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const { cookies } = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    return cookies || null;
  } catch {
    return null;
  }
}

/** Clear stored session (called on logout). */
export function clearDesktopCookies(): void {
  try {
    if (existsSync(SESSION_FILE)) writeFileSync(SESSION_FILE, '{}');
  } catch {
    /* best-effort */
  }
}
