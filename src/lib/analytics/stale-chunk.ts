/**
 * A deploy that rotates the `_app/immutable` chunk hashes while a tab is open
 * strands that tab: its next lazy `import()` 404s before SvelteKit's own
 * `updated.current` full-reload guard (`src/routes/+layout.svelte`) ever gets
 * a chance to run, because that guard only fires on the NEXT navigation, not
 * on the import failure itself. The fix here is reactive — reload once, and
 * only once per minute, so a tab that's genuinely stuck on stale chunks for
 * another reason (offline, a broken deploy) doesn't reload-loop.
 */
const STALE_CHUNK_RE =
  /dynamically imported module|Failed to fetch dynamically imported|Importing a module script failed|Loading chunk .* failed|Loading CSS chunk/i;

const RELOAD_GUARD_KEY = 'hub:chunk-reload';
const RELOAD_GUARD_WINDOW_MS = 60_000;

export function isStaleChunkError(message: string | null | undefined): boolean {
  return typeof message === 'string' && STALE_CHUNK_RE.test(message);
}

/** A narrow Storage-shaped interface so this is testable without `sessionStorage`. */
export interface ReloadGuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function shouldReloadForStaleChunk(now: number, storage: ReloadGuardStorage): boolean {
  try {
    const stored = storage.getItem(RELOAD_GUARD_KEY);
    const last = stored === null ? null : Number(stored);
    if (last !== null && Number.isFinite(last) && now - last < RELOAD_GUARD_WINDOW_MS)
      return false;
    storage.setItem(RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    // Storage unavailable (private mode, quota) — reload is still the right
    // call for a genuinely stale tab; we just lose the repeat-guard.
    return true;
  }
}
