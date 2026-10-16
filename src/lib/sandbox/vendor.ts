/**
 * Runtime libraries a sandbox element may load.
 *
 * `?url` emits the library whole as a hashed, cached asset (plan D3): element
 * code cannot reach the app bundle, so nothing is tree-shaken away and the app
 * bundle does not grow for an ad-hoc visual. Adding a library is one import
 * plus one entry here — the srcdoc CSP already allows the hub origin.
 */
import echartsUrl from 'echarts/dist/echarts.min.js?url';

export const VENDOR = { echarts: echartsUrl } as const;

export type VendorName = keyof typeof VENDOR;

export type VendorUrls = Readonly<Record<string, string>>;

/**
 * `<script src>` tags for the named libraries. The bridge loads `echarts`
 * lazily from the same map, so this is the eager path — for a future library
 * that must exist before the element's own JS runs.
 */
export function vendorScriptTags(names: readonly VendorName[]): string {
  return names.map((name) => `<script src="${VENDOR[name]}"></script>`).join('');
}
