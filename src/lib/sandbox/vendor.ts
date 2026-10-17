/**
 * Runtime libraries a sandbox element may load (the allowlist the bridge's
 * `minion.load(name)` resolves against; each `minion.<lib>` promise below is
 * lazy, so an element pays only for what it reads).
 *
 * `?url` emits the library whole as a hashed, cached asset (plan D3): element
 * code cannot reach the app bundle, so nothing is tree-shaken away and the app
 * bundle does not grow for an ad-hoc visual. Adding a library is one import
 * plus one entry here — the srcdoc CSP already allows the hub origin.
 *
 * - `echarts` (1.1 MB / 369 KB gz): the default for charts.
 * - `echarts-gl` (640 KB / 175 KB gz): 3D — bar3D, scatter3D, surface, globe —
 *   registers into the SAME echarts instance (`minion.echartsGl`), so the model
 *   keeps one API family and the frame one engine. Needs WebGL.
 * - `d3` (196 KB / 64 KB gz; full d3 is 280 KB / 93 KB): bespoke marks,
 *   hierarchies, force layouts. A slim bundle of the modules in
 *   `vendor/d3-slim.ts`, prebuilt into `static/` by `bun run vendor:d3` so the
 *   app bundle and the Vite pipeline stay untouched (a `?url` on a TS entry
 *   would ship untransformed ESM, which a classic `<script src>` cannot run).
 */
import echartsUrl from 'echarts/dist/echarts.min.js?url';
import echartsGlUrl from 'echarts-gl/dist/echarts-gl.min.js?url';

export const VENDOR = {
  echarts: echartsUrl,
  'echarts-gl': echartsGlUrl,
  d3: '/vendor/d3-slim.min.js',
} as const;

export type VendorName = keyof typeof VENDOR;

export type VendorUrls = Readonly<Record<string, string>>;

/**
 * `<script src>` tags for the named libraries. The bridge loads them lazily
 * from the same map, so this is the eager path — for a future library that
 * must exist before the element's own JS runs.
 */
export function vendorScriptTags(names: readonly VendorName[]): string {
  return names.map((name) => `<script src="${VENDOR[name]}"></script>`).join('');
}
