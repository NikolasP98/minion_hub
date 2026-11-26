// The block kit's manual for a model: one description and one complete example per kind.
// Shared by the in-page assistant tools and the MCP endpoint (spec 136), so they cannot drift.
import type { BlockKind } from './schema';

/**
 * Block kit (spec 049): one tool per block kind, schema generated from the
 * grammar the server validates with. The descriptions are operative — they
 * are the model's only manual for choosing a kind.
 */
/** Appended to every data kind: how a block joins a synced page (spec 150). */
const LISTENS_NOTE =
  ' To make it follow a page filter, pass `listens`: up to 6 `{ var, col }` entries, where `var` ' +
  'is the value name a sandbox.block_filter publishes and `col` is one of THIS block’s own ' +
  'columns (not personal data). Create the filter and the connected blocks in ONE reply; a ' +
  'connection to a name nobody publishes is saved but ignored until the filter exists. ' +
  'Changing a block without mentioning `listens` keeps its connections; use sandbox.wire to ' +
  'change only the connections.';

const KIND_DESCRIPTIONS: Record<BlockKind, string> = {
  kpi:
    'Add or replace a KPI tile: ONE number from a dataset (count/sum/avg/min/max of a column), ' +
    'rendered with the hub’s own typography and theme. Options: `source.period` for a time ' +
    'window (today, last_7d, last_30d, this_month, last_month, this_year…), `compare: true` ' +
    'for the change versus the previous period, `trend` (day|week|month) for a sparkline, ' +
    '`target` for a progress bar toward a goal, `format` (number|compact|money|percent) and ' +
    '`tone`. Prefer this over a custom element for any single metric. Width 1, height 1 is ' +
    'the default tile.',
  chart:
    'Add or replace a chart from a preset: bar, horizontal-bar, stacked-bar, line, area, pie, ' +
    'donut. `source.measures` are the series (one per aggregate); set EXACTLY ONE of ' +
    '`source.dimension` (a category column: one bar/slice per value) or `source.time` ' +
    '(a timestamp column + bucket day|week|month: a time series). `format` drives the axis ' +
    'and tooltip (money shows the currency symbol). Colours, legend, axes, resize and the ' +
    'accessible data table are automatic. Prefer this over a custom element for any standard ' +
    'chart; time series look best at w=4, categories at w=2.',
  table:
    'Add or replace a table of rows from a dataset using the hub’s own DataTable (sortable ' +
    'headers, resizable columns). `source.select` picks columns in order (dataset defaults ' +
    'when omitted), `source.orderBy` and `source.limit` (≤200) shape the rows, `formats` maps ' +
    'a column to number|compact|money|percent|date|text when the inferred type is wrong. ' +
    'Prefer this over a custom element for any row list. Width 2–4, height 2.',
  list:
    'Add or replace a ranked list: one metric per distinct value of `source.dimension` ' +
    '(top products, sales by staff, contacts by source), shown as labelled bars with the ' +
    'formatted value, largest first, `source.limit` rows (≤20, default 8). Prefer this over ' +
    'a bar chart when the user wants to READ the values. Width 1–2, height 2.',
};

export const BLOCK_DESCRIPTIONS: Record<BlockKind, string> = {
  kpi: KIND_DESCRIPTIONS.kpi + LISTENS_NOTE,
  chart: KIND_DESCRIPTIONS.chart + LISTENS_NOTE,
  table: KIND_DESCRIPTIONS.table + LISTENS_NOTE,
  list: KIND_DESCRIPTIONS.list + LISTENS_NOTE,
};

/** The filter tool's manual (spec 150): operative, the model's only guide to synced pages. */
export const FILTER_DESCRIPTION =
  'Add or replace a page FILTER: a control in the filter bar above the blocks that publishes ' +
  'one page value under `var` (a short lowercase word: letter first, up to 32 letters, digits ' +
  'or underscores). `control` is date_range (one of today, yesterday, last_7d, last_30d, ' +
  'last_90d, this_week, this_month, last_month, this_year, all), select (one value) or ' +
  'multi_select (up to 100 values); pickers need `options: { dataset, col }`, the column ' +
  'whose most common values (top 200) are the choices — never a personal-data column. ' +
  '`default` is the initial value (kind date | select | multi, matching the control). A filter ' +
  'does nothing by itself: connect blocks with `listens` on sandbox.block_* or sandbox.wire. ' +
  'A date filter fits only timestamp columns; a picker fits columns of its choices’ type. ' +
  'Filters never take a grid cell and cannot be rearranged.';

export const FILTER_EXAMPLE: Record<string, unknown> = {
  title: 'Service',
  var: 'service',
  control: 'select',
  options: { dataset: 'pos.ticket_lines', col: 'product_name' },
};

/** One complete synced page: a date filter, a connected KPI and chart, and one block left alone. */
export const WIRED_PAGE_EXAMPLE = {
  filters: [
    {
      title: 'Period',
      var: 'period',
      control: 'date_range',
      default: { kind: 'date', range: 'last_30d' },
    },
  ],
  blocks: [
    {
      kind: 'kpi',
      title: 'Sales',
      source: {
        dataset: 'pos.tickets',
        metric: { fn: 'sum', col: 'total' },
        period: { col: 'submitted_at', range: 'this_month' },
      },
      format: 'money',
      listens: [{ var: 'period', col: 'submitted_at' }],
    },
    {
      kind: 'chart',
      title: 'Bookings per week',
      w: 4,
      preset: 'bar',
      source: {
        dataset: 'scheduling.bookings',
        time: { col: 'start_time', bucket: 'week' },
        measures: [{ fn: 'count', col: '*' }],
      },
      listens: [{ var: 'period', col: 'start_time' }],
    },
    {
      kind: 'kpi',
      title: 'Sales this year (not connected: ignores the filter)',
      source: {
        dataset: 'pos.tickets',
        metric: { fn: 'sum', col: 'total' },
        period: { col: 'submitted_at', range: 'this_year' },
      },
      format: 'money',
    },
  ],
};

export const BLOCK_EXAMPLES: Record<BlockKind, Record<string, unknown>> = {
  kpi: {
    title: 'Sales this month',
    source: {
      dataset: 'pos.tickets',
      metric: { fn: 'sum', col: 'total' },
      period: { col: 'submitted_at', range: 'this_month' },
      filters: [{ col: 'status', op: 'eq', value: 'submitted' }],
    },
    format: 'money',
    compare: true,
    trend: 'day',
  },
  chart: {
    title: 'Revenue per week',
    w: 4,
    preset: 'area',
    source: {
      dataset: 'pos.tickets',
      time: { col: 'submitted_at', bucket: 'week' },
      measures: [{ fn: 'sum', col: 'total', label: 'Revenue' }],
      period: { col: 'submitted_at', range: 'last_90d' },
    },
    format: 'money',
  },
  table: {
    title: 'Latest contacts',
    w: 2,
    h: 2,
    source: {
      dataset: 'crm.contacts',
      select: ['display_name', 'source', 'created_at'],
      orderBy: [{ col: 'created_at', dir: 'desc' }],
      limit: 20,
    },
  },
  list: {
    title: 'Top products',
    w: 2,
    h: 2,
    source: {
      dataset: 'pos.ticket_lines',
      dimension: 'product_name',
      metric: { fn: 'sum', col: 'total' },
      period: { col: 'submitted_at', range: 'last_30d' },
    },
    format: 'money',
  },
};
