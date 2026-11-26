/**
 * The agent's view of the sandbox board (spec 013 S2/S3): one short line per
 * element, derived from the element rows, so the model knows what already
 * exists before it builds, and the pure diff between a grid layout and the
 * rows, so a drag/resize becomes the minimal set of PATCHes.
 */
import type { GridLayout } from '$lib/components/dashboard/editable-grid';
import type { BlockSpec, Listens } from './blocks/schema';
import type { WiringProblem, WiringReport } from './wiring-types';

export interface ElementLike {
  id: string;
  title: string;
  w: number;
  h: number;
  position: number;
  js: string;
  /** Present on block elements (spec 049); the description reads it exactly. */
  spec?: BlockSpec | null;
}

export interface ElementDescription {
  id: string;
  title: string;
  w: number;
  h: number;
  position: number;
  /** Dataset ids the element JS queries (`dataset: '…'`). */
  datasets: string[];
  /** Block kind (+ chart preset) for a block; ECharts series type inferred for custom JS. */
  chart: string | null;
  /** Connections to page filters (spec 150), as saved. */
  listens: Listens;
  /** Wiring problems the server reported for this block's connections. */
  problems: WiringProblem[];
}

// TODO(handoff): regex inference over CUSTOM element JS only — a custom element
// that builds its spec dynamically reports "no query". Blocks (spec 049) are
// described from their stored spec; see meta proposals/2026-10-16-hub-sandbox-pages-followups.md.
const DATASET_RE = /dataset\s*:\s*['"`]([\w.]+)['"`]/g;
const CHART_RE =
  /type\s*:\s*['"`](bar|line|pie|scatter|heatmap|radar|gauge|funnel|treemap|sunburst|sankey|boxplot|candlestick)['"`]/;

export function describeElement(e: ElementLike, wiring?: WiringReport | null): ElementDescription {
  if (e.spec?.type === 'filter') {
    return {
      id: e.id,
      title: e.title,
      w: e.w,
      h: e.h,
      position: e.position,
      datasets: e.spec.options ? [e.spec.options.dataset] : [],
      chart: `filter:${e.spec.control}`,
      listens: [],
      problems: [],
    };
  }
  if (e.spec) {
    return {
      id: e.id,
      title: e.title,
      w: e.w,
      h: e.h,
      position: e.position,
      datasets: [e.spec.source.dataset],
      chart: e.spec.type === 'chart' ? `${e.spec.type}:${e.spec.preset}` : e.spec.type,
      listens: e.spec.listens ?? [],
      problems: wiring?.blocks[e.id]?.problems ?? [],
    };
  }
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
    listens: [],
    problems: [],
  };
}

export function byPosition<T extends ElementLike>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

const isFilter = (e: ElementLike) => e.spec?.type === 'filter';

/** Filters live in the filter bar: only these elements take a grid cell, order or size. */
export const joinsGrid = (e: { spec?: BlockSpec | null }) => e.spec?.type !== 'filter';

function describeFilter(e: ElementLike): string {
  const spec = e.spec;
  if (spec?.type !== 'filter') return '';
  const from = spec.options ? ` · choices from ${spec.options.dataset}.${spec.options.col}` : '';
  const fallback = spec.default
    ? spec.default.kind === 'date'
      ? spec.default.range
      : spec.default.kind === 'select'
        ? String(spec.default.value)
        : spec.default.values.join(', ')
    : 'none';
  return `- [${e.id}] "${e.title}" ${spec.control} · value name "${spec.var}"${from} · default ${fallback}`;
}

/**
 * Model-only canvas map: filters first (kind, value name, default), then one
 * line per grid element — id, title, size, datasets, chart type — with each
 * block's connections (`value name → column`) and the wiring problems the
 * server reported for them (spec 150 FR-010).
 */
export function canvasSummary(
  elements: readonly ElementLike[],
  wiring?: WiringReport | null,
  cols = 4,
): string {
  const filters = byPosition(elements.filter(isFilter));
  const grid = elements.filter((e) => !isFilter(e));
  const parts: string[] = [];
  if (filters.length > 0) {
    parts.push(
      `Filters (${filters.length}, shown in the filter bar above the grid):\n` +
        filters.map(describeFilter).join('\n'),
    );
    for (const dup of wiring?.duplicates ?? []) {
      parts.push(
        `Note: filters ${dup.elementIds.map((id) => `[${id}]`).join(', ')} share the value name "${dup.var}"; they set the same value.`,
      );
    }
  }
  if (grid.length === 0) {
    parts.push(`Canvas: empty (${cols} columns).`);
    return parts.join('\n');
  }
  const rows = byPosition(grid).map((e, i) => {
    const d = describeElement(e, wiring);
    const data = d.datasets.length ? d.datasets.join(', ') : 'no query';
    const links = d.listens.length
      ? ` · connected: ${d.listens.map((l) => `${l.var} → ${l.col}`).join(', ')}`
      : '';
    const issues = d.problems.length
      ? ` · PROBLEMS: ${d.problems.map((p) => `${p.var} (${p.code}: ${p.detail})`).join('; ')}`
      : '';
    return `${i + 1}. [${d.id}] "${d.title}" ${d.w}x${d.h} · ${data}${d.chart ? ` · ${d.chart}` : ''}${links}${issues}`;
  });
  parts.push(
    `Canvas (${cols} columns, ${grid.length} element${grid.length === 1 ? '' : 's'}, display order):\n` +
      rows.join('\n'),
  );
  return parts.join('\n');
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
