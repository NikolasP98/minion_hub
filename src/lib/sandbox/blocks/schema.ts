/**
 * The block grammar (spec 049): ONE zod definition that the assistant tools
 * expose as JSON Schema (`blockToolSchemas`) and the API parses before storing
 * (`blockSpecSchema`). A block is data — a dataset connection plus presets —
 * rendered natively with the hub's shared components; it never carries code.
 *
 * Pure TS: imported by browser tools and by server routes alike, so nothing
 * here may touch `$server`, Svelte or the DOM.
 */
import { z } from 'zod';

export const BLOCK_KINDS = ['kpi', 'chart', 'table', 'list'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const FORMATS = ['number', 'compact', 'money', 'percent'] as const;
export type Format = (typeof FORMATS)[number];

/** Semantic status tokens only (governance: never accent for a status level). */
export const TONES = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

export const RANGES = [
  'today',
  'yesterday',
  'last_7d',
  'last_30d',
  'last_90d',
  'this_week',
  'this_month',
  'last_month',
  'this_year',
  'all',
] as const;
export type Range = (typeof RANGES)[number];

export const BUCKETS = ['day', 'week', 'month'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const CHART_PRESETS = [
  'bar',
  'horizontal-bar',
  'stacked-bar',
  'line',
  'area',
  'pie',
  'donut',
] as const;
export type ChartPreset = (typeof CHART_PRESETS)[number];

export const METRIC_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
/** Mirrors `OPS` in the server compiler; the compiler re-validates. */
export const FILTER_OPS = [
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
] as const;

const col = z.string().min(1).max(100).describe('Column name as listed by sandbox.datasets.');

const metricSchema = z
  .object({
    fn: z.enum(METRIC_FNS),
    col: z.string().min(1).max(100).describe("Column to aggregate ('*' only with count)."),
  })
  .describe('The number the block shows.');

const measureSchema = metricSchema.extend({
  label: z.string().max(60).optional().describe('Series label; defaults to "fn col".'),
});

const periodSchema = z
  .object({
    col: col.describe('Timestamp column the window applies to.'),
    range: z.enum(RANGES),
  })
  .describe('Time window, relative to the moment the block renders.');

const filterSchema = z.object({
  col,
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

const baseSource = {
  dataset: z.string().min(1).max(100).describe('Dataset id from sandbox.datasets.'),
  filters: z.array(filterSchema).max(10).optional().describe('Extra row filters (AND).'),
  period: periodSchema.optional(),
};

const currency = z
  .string()
  .length(3)
  .optional()
  .describe("ISO code for format 'money' (default PEN).");

export const kpiParamsSchema = z.object({
  source: z.object({ ...baseSource, metric: metricSchema }),
  format: z.enum(FORMATS).default('number'),
  currency,
  tone: z.enum(TONES).default('accent'),
  compare: z
    .boolean()
    .optional()
    .describe(
      'Show the change versus the previous period of the same length (needs source.period).',
    ),
  trend: z
    .enum(BUCKETS)
    .optional()
    .describe(
      'Sparkline of the metric per day/week/month inside the period (needs source.period).',
    ),
  target: z.number().positive().optional().describe('Goal value: adds a progress bar toward it.'),
  unit: z.string().max(12).optional().describe('Suffix after the value, e.g. "tickets".'),
});

export const chartParamsSchema = z.object({
  preset: z.enum(CHART_PRESETS).default('bar'),
  source: z.object({
    ...baseSource,
    measures: z.array(measureSchema).min(1).max(6).describe('One series per measure.'),
    dimension: col
      .optional()
      .describe('Category axis column (one bar/slice per distinct value). Either this or time.'),
    time: z
      .object({ col: col.describe('Timestamp column.'), bucket: z.enum(BUCKETS) })
      .optional()
      .describe('Time axis: one point per bucket. Either this or dimension.'),
    sort: z
      .enum(['value_desc', 'value_asc', 'label'])
      .optional()
      .describe('Category order (dimension charts only; default value_desc).'),
    limit: z.number().int().min(1).max(500).optional().describe('Max categories/points.'),
  }),
  format: z.enum(FORMATS).default('number'),
  currency,
});

export const tableParamsSchema = z.object({
  source: z.object({
    ...baseSource,
    select: z
      .array(col)
      .max(12)
      .optional()
      .describe('Columns, in order; dataset defaults when omitted.'),
    orderBy: z
      .array(z.object({ col, dir: z.enum(['asc', 'desc']).optional() }))
      .max(3)
      .optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  formats: z
    .record(z.string(), z.enum([...FORMATS, 'date', 'text']))
    .optional()
    .describe('Per-column display format; inferred from the column type when omitted.'),
  currency,
});

export const listParamsSchema = z.object({
  source: z.object({
    ...baseSource,
    dimension: col.describe('Label column (one row per distinct value).'),
    metric: metricSchema,
    limit: z.number().int().min(1).max(20).default(8),
  }),
  format: z.enum(FORMATS).default('number'),
  currency,
});

export const BLOCK_PARAMS = {
  kpi: kpiParamsSchema,
  chart: chartParamsSchema,
  table: tableParamsSchema,
  list: listParamsSchema,
} as const;

/** The stored shape: `{ v: 1, type, ...params }` (spelled out so inference stays exact). */
export const blockSpecSchema = z.discriminatedUnion('type', [
  kpiParamsSchema.extend({ v: z.literal(1), type: z.literal('kpi') }),
  chartParamsSchema.extend({ v: z.literal(1), type: z.literal('chart') }),
  tableParamsSchema.extend({ v: z.literal(1), type: z.literal('table') }),
  listParamsSchema.extend({ v: z.literal(1), type: z.literal('list') }),
]);

export type BlockSpec = z.infer<typeof blockSpecSchema>;
export type KpiSpec = Extract<BlockSpec, { type: 'kpi' }>;
export type ChartSpec = Extract<BlockSpec, { type: 'chart' }>;
export type TableSpec = Extract<BlockSpec, { type: 'table' }>;
export type ListSpec = Extract<BlockSpec, { type: 'list' }>;

/** Shape-only check; the API additionally validates columns against the registry. */
export function parseBlockSpec(raw: unknown): BlockSpec {
  return blockSpecSchema.parse(raw);
}

const toolEnvelope = {
  id: z.string().optional().describe('Omit to create; pass an element id to replace it.'),
  title: z.string().min(1).max(200).describe('Short label shown above the block.'),
  w: z.number().int().min(1).max(4).optional().describe('Width in grid columns (1-4).'),
  h: z.number().int().min(1).max(4).optional().describe('Height in grid rows (1-4).'),
};

export interface BlockToolSchema {
  kind: BlockKind;
  /** JSON Schema for the tool input: envelope + the kind's params. */
  inputSchema: Record<string, unknown>;
  /** Parses a tool input into `{ id, title, w, h, spec }`. */
  parse: (input: unknown) => {
    id?: string;
    title: string;
    w?: number;
    h?: number;
    spec: BlockSpec;
  };
}

/**
 * One tool schema per kind, derived from the zod grammar so the model's manual
 * and the server's validator cannot drift. `io: 'input'` keeps defaulted
 * fields optional for the caller.
 */
export function blockToolSchemas(): BlockToolSchema[] {
  return BLOCK_KINDS.map((kind) => {
    const params = BLOCK_PARAMS[kind];
    const input = z.object({ ...toolEnvelope, ...params.shape });
    const { $schema: _dropped, ...inputSchema } = z.toJSONSchema(input, { io: 'input' });
    return {
      kind,
      inputSchema,
      parse: (raw: unknown) => {
        const { id, title, w, h, ...rest } = input.parse(raw);
        return { id, title, w, h, spec: blockSpecSchema.parse({ v: 1, type: kind, ...rest }) };
      },
    };
  });
}
