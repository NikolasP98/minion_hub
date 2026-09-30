/**
 * Record peek — open a record page WITHOUT leaving the list (Notion's "open in
 * side peek / center peek / full page").
 *
 * Mechanism = SvelteKit shallow routing: `preloadData(href)` runs the target
 * page's server load through the normal data endpoint, then `pushState('',
 * { peek })` adds a history entry that KEEPS the current URL (so the root and
 * (app) layouts' `{#key first-segment}` shells never re-key and the list stays
 * mounted). `RecordPeek.svelte` (mounted once in the app layout) renders the
 * target route's own `+page.svelte` with that data inside a Dialog (modal) or
 * a Sheet (tray). Back / Escape / ✕ pop the entry; "Expand" replaces it with a
 * real navigation to `href`.
 *
 * Mode resolution (`openModeFor`, `resolveOpenMode`): explicit prop > the
 * user's own preference (`preferences.tableOpenIn`) > the org's table config
 * (`app_table_config[tableId].openIn`, set on /settings/tables) > `'page'`.
 */
import { getContext, setContext } from 'svelte';
import { page } from '$app/state';
import { goto, preloadData, pushState } from '$lib/navigation';
import { localizePath } from '$lib/canonical-path';
import { tableConfig } from '$lib/tables/config.svelte';
import { resolvePeekPage } from './peek-registry';
import { createSaveStatus, type SaveStatus } from './save-status.svelte';

export const OPEN_MODES = ['page', 'modal', 'tray'] as const;
export type OpenMode = (typeof OPEN_MODES)[number];
export type PeekMode = Exclude<OpenMode, 'page'>;

export interface PeekState {
  href: string;
  mode: PeekMode;
  data: Record<string, unknown>;
}

export const isOpenMode = (v: unknown): v is OpenMode =>
  typeof v === 'string' && (OPEN_MODES as readonly string[]).includes(v);

/** Pure precedence rule (spec 2026-09-28 Bundle E #3): explicit prop > the
 *  user's own preference > the org's table config > the page default. Kept
 *  standalone so the resolution order is unit-testable without a page/store. */
export function resolveOpenMode(
  explicit?: OpenMode | null,
  userPref?: OpenMode | null,
  orgCfg?: OpenMode | null,
): OpenMode {
  return explicit ?? userPref ?? orgCfg ?? 'page';
}

/** Per-user open-mode overrides (`preferences.tableOpenIn`), loaded once by
 *  the app layout alongside the org's `tableConfig()`. */
export function userOpenModes(): Record<string, OpenMode> {
  const raw = (
    page.data as {
      preferences?: { preferences?: Record<string, unknown> };
    }
  )?.preferences?.preferences?.tableOpenIn;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, OpenMode>)
    : {};
}

// /settings/tables reads the ORG entry directly (never the viewer's own override).
export function openModeFor(tableId?: string | null, explicit?: OpenMode | null): OpenMode {
  if (!tableId) return resolveOpenMode(explicit, null, null);
  const userPref = userOpenModes()[tableId];
  const orgCfgRaw = (tableConfig()[tableId] as { openIn?: unknown } | undefined)?.openIn;
  return resolveOpenMode(
    explicit,
    isOpenMode(userPref) ? userPref : null,
    isOpenMode(orgCfgRaw) ? orgCfgRaw : null,
  );
}

/**
 * Open `href` in `mode`. Falls back to a full navigation when the route has no
 * peek-able page registered or its load fails (404/redirect/error) — the user
 * always ends up on the record, never on a blank panel.
 */
export async function openRecord(href: string, mode: OpenMode = 'page'): Promise<void> {
  if (mode === 'page' || !resolvePeekPage(href)) {
    await goto(href);
    return;
  }
  const result = await preloadData(localizePath(href));
  if (result.type !== 'loaded' || result.status !== 200) {
    await goto(href);
    return;
  }
  pushState('', { peek: { href, mode, data: result.data as Record<string, unknown> } });
}

/** True for clicks the browser should keep (new tab / window / download). */
export const isModifiedClick = (e: MouseEvent) =>
  e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/** `onclick` for an `<a href>` that should honour `mode` on a plain click. */
export function peekClick(href: string, mode: OpenMode) {
  return (e: MouseEvent) => {
    if (mode === 'page' || isModifiedClick(e) || e.defaultPrevented) return;
    e.preventDefault();
    void openRecord(href, mode);
  };
}

/** Pops the shallow-routing entry (`RecordPeek` unmounts when `page.state.peek` clears). */
export function closePeek(): void {
  history.back();
}

/** Full navigation to the peeked record, REPLACING the peek entry so Back returns to the list. */
export function expandPeek(href: string): Promise<void> {
  return goto(href, { replaceState: true });
}

// ── Context: pages ask "am I rendered inside a peek?" to drop their own back
//    button / page chrome, and get the peek's shared save-status indicator.
//    `RecordPeek` provides it; a route render has none of either.
interface PeekContextValue {
  saveStatus: SaveStatus;
}
const PEEK_CTX = Symbol('record-peek');
export function providePeekContext(): void {
  setContext<PeekContextValue>(PEEK_CTX, { saveStatus: createSaveStatus() });
}
export function inPeek(): boolean {
  return getContext<PeekContextValue | undefined>(PEEK_CTX) !== undefined;
}
/** The peek's shared save-status indicator, or `null` outside a peek (a
 *  bare-page render creates its own via `createSaveStatus()`). */
export function peekSaveStatus(): SaveStatus | null {
  return getContext<PeekContextValue | undefined>(PEEK_CTX)?.saveStatus ?? null;
}
