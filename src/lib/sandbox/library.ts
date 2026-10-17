/**
 * The component library (spec 014): ordinary element rows on the reserved page
 * `library`. The viewer sees their own rows and every published one (service
 * rule); adding to a board is a COPY, so the library entry and the board
 * element never reference each other.
 */
import { fetchJson } from '$lib/api/fetch-json';
import type { SandboxElementRecord } from './host.svelte';

export const LIBRARY_PAGE = 'library';
/** Dispatched on `window` after any library write so an open panel refreshes. */
export const LIBRARY_CHANGED_EVENT = 'minion:sandbox-library-changed';
/** `dataTransfer` type for a dragged component (payload: the JSON copy). */
export const DRAG_MIME = 'application/x-minion-component';

export type LibraryComponent = SandboxElementRecord;
export type ComponentCopy = Pick<SandboxElementRecord, 'title' | 'html' | 'css' | 'js' | 'w' | 'h'>;

const ELEMENTS_URL = '/api/sandbox/elements';
const JSON_HEADERS = { 'content-type': 'application/json' };

export function componentCopy(e: ComponentCopy): ComponentCopy {
  return { title: e.title, html: e.html, css: e.css, js: e.js, w: e.w, h: e.h };
}

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}

export async function listLibrary(): Promise<LibraryComponent[]> {
  const body = await fetchJson<{ elements?: LibraryComponent[] }>(
    `${ELEMENTS_URL}?page=${LIBRARY_PAGE}`,
  );
  return body.elements ?? [];
}

/** Snapshot a board element into the viewer's library (unpublished). */
export async function saveToLibrary(e: ComponentCopy): Promise<LibraryComponent> {
  const body = await fetchJson<{ element: LibraryComponent }>(ELEMENTS_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...componentCopy(e), page: LIBRARY_PAGE }),
  });
  announce();
  return body.element;
}

/** Instantiate a component on a board page; the caller reloads the board. */
export async function addToPage(c: ComponentCopy, page = 'default'): Promise<SandboxElementRecord> {
  const body = await fetchJson<{ element: SandboxElementRecord }>(ELEMENTS_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...componentCopy(c), page }),
  });
  return body.element;
}

export async function setPublished(id: string, published: boolean): Promise<void> {
  await fetchJson<unknown>(`${ELEMENTS_URL}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ published }),
  });
  announce();
}

export async function removeFromLibrary(id: string): Promise<void> {
  await fetchJson<unknown>(`${ELEMENTS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  announce();
}
