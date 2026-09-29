/**
 * Which record pages can render inside a peek (modal / tray). Each entry maps
 * a canonical (locale-stripped) path to the route's OWN `+page.svelte`, loaded
 * lazily — no second "summary" component per record; the page checks
 * `inPeek()` to hide its back button. Add a route = one line here.
 */
import type { Component } from 'svelte';
import { canonicalPath } from '$lib/canonical-path';

export type PeekPage = Component<{ data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Loader = () => Promise<{ default: PeekPage }>;

const ID = '[^/]+';
const ROUTES: { pattern: RegExp; load: Loader }[] = [
  {
    pattern: new RegExp(`^/stock/items/(?!new$)${ID}$`),
    load: () =>
      import('../../routes/(app)/stock/items/[id]/+page.svelte') as Promise<{ default: PeekPage }>,
  },
  {
    pattern: new RegExp(`^/stock/entries/(?!new$)${ID}$`),
    load: () =>
      import('../../routes/(app)/stock/entries/[id]/+page.svelte') as Promise<{
        default: PeekPage;
      }>,
  },
  {
    pattern: new RegExp(`^/pos/tickets/${ID}$`),
    load: () =>
      import('../../routes/(app)/pos/tickets/[id]/+page.svelte') as Promise<{ default: PeekPage }>,
  },
  {
    pattern: new RegExp(`^/finances/invoices/${ID}$`),
    load: () =>
      import('../../routes/(app)/finances/invoices/[id]/+page.svelte') as Promise<{
        default: PeekPage;
      }>,
  },
  {
    pattern: new RegExp(`^/pos/catalog/${ID}/edit$`),
    load: () =>
      import('../../routes/(app)/pos/catalog/[productId]/edit/+page.svelte') as Promise<{
        default: PeekPage;
      }>,
  },
];

/** The lazy page loader for `href`, or null when the route is not peek-able. */
export function resolvePeekPage(href: string): Loader | null {
  const path = canonicalPath(href.split(/[?#]/)[0]);
  return ROUTES.find((r) => r.pattern.test(path))?.load ?? null;
}
