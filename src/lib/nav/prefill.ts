/**
 * Cross-module navigation glue — Minion's port of ERPNext's `frappe.route_options`.
 *
 * ERPNext carries context between pages (filter a list by the parent, pre-fill a
 * new record's link field) through a `route_options` object the router serializes
 * into URL query params. In SvelteKit the URL already IS that channel: build a
 * link with `linkTo()`, read it back in a `load()` with `readPrefill()`.
 *
 * Used by: the Connections panel (filter + "+New"), fetch_from autofill, and the
 * command palette — all share this one mechanism, so "open in new tab" just works.
 */

/** Build `path?key=val&…`, dropping null/undefined/'' params. */
export function linkTo(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Read the given keys from a URL's search params into a plain object (omits absent). */
export function readPrefill<K extends string>(url: URL, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = url.searchParams.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}
