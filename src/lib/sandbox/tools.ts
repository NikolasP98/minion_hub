/**
 * Page-scoped assistant tools for `/sandbox` (contract §5, spec FR-008).
 *
 * These five tools exist in the registry only while the sandbox page is
 * mounted, so their schemas enter the assistant envelope (via
 * `uiToolsBriefing(getTools())`) on the sandbox and nowhere else — that is the
 * whole point of registering them here rather than in global-tools.
 *
 * The descriptions below are the model's ONLY manual for authoring elements:
 * there is no second place that teaches it the preview-then-write order, the
 * `minion.*` runtime or the grid sizes. Keep them operative, not decorative.
 */
import { registerTool, type ModelContextTool } from '$lib/assistant/model-context';
import { fetchJson } from '$lib/api/fetch-json';

/** The sandbox page listens for this and re-renders the element's iframe. */
export const SANDBOX_CHANGED_EVENT = 'minion:sandbox-changed';

/** `sandbox.preview` is a look, not a load: the model never needs more rows. */
const PREVIEW_LIMIT = 20;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function changed(id: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SANDBOX_CHANGED_EVENT, { detail: { id } }));
  }
}

/** Routes may wrap a collection (`{datasets|elements: []}`) or return it bare. */
function collection<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  const wrapped = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(wrapped) ? (wrapped as T[]) : [];
}

function elementId(body: unknown, fallback: string): string {
  const record = (body ?? {}) as Record<string, unknown>;
  const nested = (record.element ?? {}) as Record<string, unknown>;
  return str(record.id) || str(nested.id) || fallback;
}

/** JSON Schema for the query spec shared by `sandbox.preview` (contract §1). */
const QUERY_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dataset: { type: 'string', description: 'Dataset id from sandbox.datasets.' },
    select: { type: 'array', items: { type: 'string' } },
    where: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          col: { type: 'string' },
          op: {
            type: 'string',
            enum: [
              'eq',
              'neq',
              'gt',
              'gte',
              'lt',
              'lte',
              'in',
              'between',
              'like',
              'startsWith',
              'isNull',
            ],
          },
          value: {},
        },
        required: ['col', 'op'],
      },
    },
    orderBy: {
      type: 'array',
      items: {
        type: 'object',
        properties: { col: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
        required: ['col'],
      },
    },
    groupBy: { type: 'array', items: { type: 'string' } },
    aggregate: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
          col: { type: 'string' },
          as: { type: 'string' },
        },
        required: ['fn', 'col', 'as'],
      },
    },
    limit: { type: 'number' },
  },
  required: ['dataset'],
} as const;

const ELEMENT_FIELDS = {
  title: { type: 'string', description: 'Short label shown above the element.' },
  html: { type: 'string', description: 'Element body markup (no <html>/<head>).' },
  css: { type: 'string', description: 'Optional CSS; use var(--…) theme tokens.' },
  js: {
    type: 'string',
    description:
      'The element logic. Runs inside the iframe with `minion` available: ' +
      'minion.ready(fn), await minion.query(spec), minion.theme, await minion.echarts, minion.size.',
  },
  w: { type: 'number', description: 'Width in grid columns, 1-4.' },
  h: { type: 'number', description: 'Height in grid rows, 1-4.' },
} as const;

function sandboxTools(): ModelContextTool[] {
  return [
    {
      name: 'sandbox.datasets',
      description:
        'List the org datasets you may query from a sandbox element, with each column, its type ' +
        'and what it means. Call this FIRST when the user asks for a chart, table or metric here: ' +
        'dataset ids and column names are the only ones sandbox.preview and minion.query accept, ' +
        'and guessing them returns an error. Datasets you cannot see are the ones this user has ' +
        'no permission for.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({
        datasets: collection(await fetchJson<unknown>('/api/sandbox/datasets'), 'datasets'),
      }),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'sandbox.preview',
      description:
        `Run a query spec and get back its real shape: the columns, up to ${PREVIEW_LIMIT} sample ` +
        'rows and the row count. Always call this before writing a new visual — it is how you ' +
        'learn the actual value formats (strings vs numbers, nulls, date shapes) instead of ' +
        'assuming them. Any limit you pass is reduced to the sample size; the element itself can ' +
        'query the full range later. A 400 names the bad dataset, column or operator.',
      inputSchema: {
        type: 'object',
        properties: { spec: QUERY_SPEC_SCHEMA },
        required: ['spec'],
      },
      execute: async (input) => {
        const spec = (input.spec ?? {}) as Record<string, unknown>;
        const raw = typeof spec.limit === 'number' ? spec.limit : PREVIEW_LIMIT;
        const result = await fetchJson<{
          columns?: unknown[];
          rows?: unknown[];
        }>('/api/sandbox/query', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...spec, limit: Math.max(1, Math.min(PREVIEW_LIMIT, raw)) }),
        });
        const rows = result.rows ?? [];
        return {
          columns: result.columns ?? [],
          sample: rows.slice(0, PREVIEW_LIMIT),
          rowCount: rows.length,
        };
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'sandbox.upsert_element',
      description:
        'Create a sandbox element, or replace one by passing its `id`. It renders immediately. ' +
        'One visual per element. Rules that make the difference between a working element and a ' +
        'blank box: query inside minion.ready(() => …) and await minion.query(spec); do the ' +
        'calculations (margins, ratios, totals, grouping) in the element JS, not in the query; ' +
        'for a chart `const echarts = await minion.echarts` and colour it from minion.theme; ' +
        'size with w/h in grid units 1-4; no external URLs or fetch — the frame has no network; ' +
        'on an error, write the message into the element so the user can read it.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Omit to create; pass to replace that element.' },
          ...ELEMENT_FIELDS,
        },
        required: ['title', 'html', 'js'],
      },
      execute: async (input) => {
        const id = str(input.id);
        const body = JSON.stringify({
          title: str(input.title),
          html: str(input.html),
          css: str(input.css),
          js: str(input.js),
          ...(typeof input.w === 'number' ? { w: input.w } : {}),
          ...(typeof input.h === 'number' ? { h: input.h } : {}),
        });
        const saved = await fetchJson<unknown>(
          id ? `/api/sandbox/elements/${encodeURIComponent(id)}` : '/api/sandbox/elements',
          { method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body },
        );
        const savedId = elementId(saved, id);
        changed(savedId);
        return { id: savedId };
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: 'sandbox.remove_element',
      description:
        'Delete a sandbox element by id. Use sandbox.list_elements first if you only know its ' +
        'title. Deletion is immediate and not undoable, so only remove what the user named.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async (input) => {
        const id = str(input.id);
        await fetchJson<unknown>(`/api/sandbox/elements/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        changed(id);
        return { ok: true, id };
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: 'sandbox.list_elements',
      description:
        'List the elements already on this page — id, title and size. Call it before changing or ' +
        'removing something the user refers to by name, and to avoid rebuilding a visual that is ' +
        'already there.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({
        elements: collection<Record<string, unknown>>(
          await fetchJson<unknown>('/api/sandbox/elements'),
          'elements',
        ).map((e) => ({ id: e.id, title: e.title, w: e.w, h: e.h })),
      }),
      annotations: { readOnlyHint: true },
    },
  ];
}

/**
 * Register the sandbox tools for the page's lifetime. Abort `signal` (on
 * unmount) to remove them — `registerTool` honours it, so leaving the page
 * takes the schemas out of the envelope again.
 */
export function registerSandboxTools(opts: { signal: AbortSignal }) {
  for (const tool of sandboxTools()) registerTool(tool, { signal: opts.signal });
}
