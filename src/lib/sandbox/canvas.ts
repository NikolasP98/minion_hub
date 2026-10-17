/**
 * The agent's view of the sandbox board (spec 013 S2/S3): one short line per
 * element, derived from the element rows, so the model knows what already
 * exists before it builds, and the pure diff between a grid layout and the
 * rows, so a drag/resize becomes the minimal set of PATCHes.
 */
import type { GridLayout } from '$lib/components/dashboard/editable-grid';

export interface ElementLike {
  id: string;
  title: string;
  w: number;
  h: number;
  position: number;
  js: string;
}

export interface ElementDescription {
  id: string;
  title: string;
  w: number;
  h: number;
  position: number;
  /** Dataset ids the element JS queries (`dataset: '…'`). */
  datasets: string[];
  /** ECharts series type if the JS declares one (`type: 'bar'`). */
  chart: string | null;
}

// TODO(handoff): regex inference over the element JS — an element that builds
// its spec dynamically reports "no query". A declared `meta` field on the
// element record is the upgrade; see meta proposals/2026-10-16-hub-sandbox-pages-followups.md.
const DATASET_RE = /dataset\s*:\s*['"`]([\w.]+)['"`]/g;
const CHART_RE =
  /type\s*:\s*['"`](bar|line|pie|scatter|heatmap|radar|gauge|funnel|treemap|sunburst|sankey|boxplot|candlestick)['"`]/;

export function describeElement(e: ElementLike): ElementDescription {
  const js = String(e.js ?? '');
  const datasets = [...new Set([...js.matchAll(DATASET_RE)].map((m) => m[1]))];
  return {
    id: e.id,
    title: e.title,
    w: e.w,
    h: e.h,
    position: e.position,
    datasets,
    chart: CHART_RE.exec(js)?.[1] ?? null,
  };
}

export function byPosition<T extends ElementLike>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** Model-only canvas map: index, full id, title, size, datasets, chart type. */
export function canvasSummary(elements: readonly ElementLike[], cols = 4): string {
  if (elements.length === 0) return `Canvas: empty (${cols} columns).`;
  const rows = byPosition(elements).map((e, i) => {
    const d = describeElement(e);
    const data = d.datasets.length ? d.datasets.join(', ') : 'no query';
    return `${i + 1}. [${d.id}] "${d.title}" ${d.w}x${d.h} · ${data}${d.chart ? ` · ${d.chart}` : ''}`;
  });
  return (
    `Canvas (${cols} columns, ${elements.length} element${elements.length === 1 ? '' : 's'}, display order):\n` +
    rows.join('\n')
  );
}

export interface LayoutUpdate {
  id: string;
  position?: number;
  w?: number;
  h?: number;
}

/** The rows whose position/size differ from `layout` — nothing else is written. */
export function layoutUpdates(
  elements: readonly ElementLike[],
  layout: GridLayout,
): LayoutUpdate[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: LayoutUpdate[] = [];
  layout.order.forEach((id, index) => {
    const e = byId.get(id);
    if (!e) return;
    const span = layout.span[id];
    const u: LayoutUpdate = { id };
    if (e.position !== index) u.position = index;
    if (span && (span.w !== e.w || span.h !== e.h)) {
      u.w = span.w;
      u.h = span.h;
    }
    if (u.position !== undefined || u.w !== undefined) out.push(u);
  });
  return out;
}
