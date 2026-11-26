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

/** The four data kinds; `filter` is a page control, not a data block (spec 150). */
export const BLOCK_KINDS = ['kpi', 'chart', 'table', 'list'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export type DataKind = BlockKind;

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

/** A page value name: short lowercase word (spec 150 FR-007). */
export const VAR_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const varName = z
  .string()
  .regex(VAR_PATTERN)
  .describe('Page value name: lowercase letter first, up to 32 letters, digits or underscores.');

/** Max connections per block (spec 150 FR-003). */
export const MAX_LISTENS = 6;
/** Max values a multi-select can hold (the compiler's `in` cap). */
export const MAX_MULTI_VALUES = 100;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** What a filter currently holds: kept in the page (URL in S2), never saved except as `default`. */
export const pageValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), range: z.enum(RANGES) }),
  z.object({ kind: z.literal('select'), value: scalar }),
  z.object({ kind: z.literal('multi'), values: z.array(scalar).max(MAX_MULTI_VALUES) }),
]);
export type PageValue = z.infer<typeof pageValueSchema>;

/**
 * Connections: "when page value `var` is set, filter my column `col`". No
 * default on purpose — an absent `listens` means "keep what is stored".
 */
export const listensSchema = z
  .array(z.object({ var: varName, col }))
  .max(MAX_LISTENS)
  .describe('Connections to page filters: { var: filter value name, col: this block column }.');
export type Listens = z.infer<typeof listensSchema>;

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
  listens: listensSchema.optional(),
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
  listens: listensSchema.optional(),
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
  listens: listensSchema.optional(),
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
  listens: listensSchema.optional(),
});

export const FILTER_CONTROLS = ['date_range', 'select', 'multi_select'] as const;
export type FilterControl = (typeof FILTER_CONTROLS)[number];

/** A page control (spec 150): publishes one page value under `var`. */
export const filterParamsSchema = z.object({
  var: varName,
  control: z.enum(FILTER_CONTROLS),
  options: z
    .object({
      dataset: z.string().min(1).max(100).describe('Dataset id from sandbox.datasets.'),
      col: col.describe('Column whose distinct values are the choices.'),
    })
    .optional()
    .describe('Choices source; required for select and multi_select, not allowed for date_range.'),
  default: pageValueSchema.optional().describe('Initial value; its kind must match the control.'),
});

export const BLOCK_PARAMS = {
  kpi: kpiParamsSchema,
  chart: chartParamsSchema,
  table: tableParamsSchema,
  list: listParamsSchema,
} as const;

/** The stored data-block shapes: `{ v: 1, type, ...params }` (spelled out so inference stays exact). */
const dataBlockMembers = [
  kpiParamsSchema.extend({ v: z.literal(1), type: z.literal('kpi') }),
  chartParamsSchema.extend({ v: z.literal(1), type: z.literal('chart') }),
  tableParamsSchema.extend({ v: z.literal(1), type: z.literal('table') }),
  listParamsSchema.extend({ v: z.literal(1), type: z.literal('list') }),
] as const;

const filterMember = filterParamsSchema.extend({ v: z.literal(1), type: z.literal('filter') });

export const dataBlockSpecSchema = z.discriminatedUnion('type', dataBlockMembers);
export const blockSpecSchema = z.discriminatedUnion('type', [...dataBlockMembers, filterMember]);

export type BlockSpec = z.infer<typeof blockSpecSchema>;
export type FilterSpec = Extract<BlockSpec, { type: 'filter' }>;
export type DataBlockSpec = Exclude<BlockSpec, FilterSpec>;
export type KpiSpec = Extract<BlockSpec, { type: 'kpi' }>;
export type ChartSpec = Extract<BlockSpec, { type: 'chart' }>;
export type TableSpec = Extract<BlockSpec, { type: 'table' }>;
export type ListSpec = Extract<BlockSpec, { type: 'list' }>;

/** Narrows to the four data kinds: only those carry `source` and run queries. */
export function isDataBlock(spec: BlockSpec | null | undefined): spec is DataBlockSpec {
  return !!spec && spec.type !== 'filter';
}

/** Shape-only check of a data block; the API additionally validates columns against the registry. */
export function parseBlockSpec(raw: unknown): DataBlockSpec {
  return dataBlockSpecSchema.parse(raw);
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
    spec: DataBlockSpec;
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
        return {
          id,
          title,
          w,
          h,
          spec: dataBlockSpecSchema.parse({ v: 1, type: kind, ...rest }),
        };
      },
    };
  });
}

export interface FilterToolSchema {
  inputSchema: Record<string, unknown>;
  /** Parses a tool input into `{ id, title, spec }`; filters have no grid size. */
  parse: (input: unknown) => { id?: string; title: string; spec: FilterSpec };
}

/** The `filter` tool, derived from the same grammar (envelope: `{ id?, title }` only). */
export function filterToolSchema(): FilterToolSchema {
  const { id, title } = toolEnvelope;
  const input = z.object({ id, title, ...filterParamsSchema.shape });
  const { $schema: _dropped, ...inputSchema } = z.toJSONSchema(input, { io: 'input' });
  return {
    inputSchema,
    parse: (raw: unknown) => {
      const { id: elementId, title: name, ...rest } = input.parse(raw);
      return {
        id: elementId,
        title: name,
        spec: blockSpecSchema.parse({ v: 1, type: 'filter', ...rest }) as FilterSpec,
      };
    },
  };
}
