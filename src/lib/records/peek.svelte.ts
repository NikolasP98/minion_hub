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
 * Mode resolution (`openModeFor`): explicit prop > the org's table config
 * (`app_table_config[tableId].openIn`, set on /settings/tables) > `'page'`.
 */
import { getContext, setContext } from 'svelte';
import { goto, preloadData, pushState } from '$lib/navigation';
import { localizePath } from '$lib/canonical-path';
import { tableConfig } from '$lib/tables/config.svelte';
import { resolvePeekPage } from './peek-registry';

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

/** Effective open mode for a table: explicit > org table config > page. */
export function openModeFor(tableId?: string | null, explicit?: OpenMode | null): OpenMode {
  if (explicit) return explicit;
  if (!tableId) return 'page';
  const v = (tableConfig()[tableId] as { openIn?: unknown } | undefined)?.openIn;
  return isOpenMode(v) ? v : 'page';
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
//    button / page chrome. `RecordPeek` provides it; a route render has none.
const PEEK_CTX = Symbol('record-peek');
export function providePeekContext(): void {
  setContext(PEEK_CTX, true);
}
export function inPeek(): boolean {
  return getContext<boolean | undefined>(PEEK_CTX) === true;
}
