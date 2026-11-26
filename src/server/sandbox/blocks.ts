/**
 * Registry-aware block validation (spec 049 I4). The shared zod grammar checks
 * SHAPE; this checks that every column a block names exists on its dataset
 * with a type the role needs (a number for sum/avg, a timestamp for
 * period/bucket), so a bad spec is a 400 naming the field at write time
 * instead of a blank block at render time.
 */
import {
  blockSpecSchema,
  type BlockSpec,
  type DataBlockSpec,
  type FilterSpec,
  type Listens,
} from '$lib/sandbox/blocks/schema';
import { findColumn, findDataset, type ColumnType, type Dataset } from './datasets';
import { fitsColumn, SandboxQueryError } from './query-compiler';

function requireColumn(dataset: Dataset, name: string, field: string, types?: ColumnType[]) {
  const column = findColumn(dataset, name);
  if (!column) {
    throw new SandboxQueryError(`unknown column ${JSON.stringify(name)} on ${dataset.id}`, field);
  }
  if (types && !types.includes(column.type)) {
    throw new SandboxQueryError(
      `column ${JSON.stringify(name)} is ${column.type}; ${field} needs ${types.join(' or ')}`,
      field,
    );
  }
  return column;
}

function requireMetric(dataset: Dataset, metric: { fn: string; col: string }, field: string) {
  if (metric.col === '*') {
    if (metric.fn !== 'count') {
      throw new SandboxQueryError(`${metric.fn}(*) is not a metric; name a column`, `${field}.col`);
    }
    return;
  }
  requireColumn(
    dataset,
    metric.col,
    `${field}.col`,
    metric.fn === 'sum' || metric.fn === 'avg' ? ['number'] : undefined,
  );
}

/** Same limit as `where` in `/api/sandbox/query` (spec 150 R10). */
const MAX_WHERE = 20;

/** Where entries a block's own filters, date window and connections can add to one query. */
function whereBudget(spec: DataBlockSpec, dataset: Dataset, listens: Listens): number {
  const own = (spec.source.filters?.length ?? 0) + (spec.source.period ? 2 : 0);
  const connected = listens.reduce(
    (total, l) => total + (findColumn(dataset, l.col)?.type === 'timestamp' ? 2 : 1),
    0,
  );
  return own + connected;
}

/**
 * Connections (spec 150): each names a block column that exists and is not
 * personal data, one per value name, and the block's own conditions plus its
 * connections must fit one data request. Cross-element problems (no filter
 * publishes the name, wrong kind) are NOT refused here: see `wiring.ts`.
 */
export function validateListens(spec: DataBlockSpec, listens: Listens | undefined): void {
  if (!listens?.length) return;
  const dataset = findDataset(spec.source.dataset);
  if (!dataset) throw new SandboxQueryError('unknown dataset', 'spec.source.dataset');
  const seen = new Set<string>();
  listens.forEach((l, i) => {
    const field = `spec.listens.${i}`;
    if (seen.has(l.var)) {
      throw new SandboxQueryError(
        `duplicate connection to ${JSON.stringify(l.var)}`,
        `${field}.var`,
      );
    }
    seen.add(l.var);
    const column = requireColumn(dataset, l.col, `${field}.col`);
    if (column.pii) {
      throw new SandboxQueryError(
        `column ${JSON.stringify(l.col)} is personal data and cannot be connected`,
        `${field}.col`,
      );
    }
  });
  const total = whereBudget(spec, dataset, listens);
  if (total > MAX_WHERE) {
    throw new SandboxQueryError(
      `filters, date range and connections add up to ${total} conditions; the limit is ${MAX_WHERE}`,
      'spec.listens',
    );
  }
}

const FILTER_DEFAULT_KIND = {
  date_range: 'date',
  select: 'select',
  multi_select: 'multi',
} as const;

function validateFilter(spec: FilterSpec): void {
  const picker = spec.control !== 'date_range';
  if (!picker && spec.options) {
    throw new SandboxQueryError('a date filter takes no options', 'spec.options');
  }
  if (picker) {
    if (!spec.options) throw new SandboxQueryError('a picker needs options', 'spec.options');
    const dataset = findDataset(spec.options.dataset);
    if (!dataset) throw new SandboxQueryError('unknown dataset', 'spec.options.dataset');
    const column = requireColumn(dataset, spec.options.col, 'spec.options.col');
    const d = spec.default;
    const candidates = d?.kind === 'select' ? [d.value] : d?.kind === 'multi' ? d.values : [];
    for (const value of candidates) {
      if (!fitsColumn(column.type, value)) {
        throw new SandboxQueryError(
          `default ${JSON.stringify(value)} does not fit ${column.type} column ${JSON.stringify(column.name)}`,
          'spec.default',
        );
      }
    }
    if (column.pii) {
      throw new SandboxQueryError(
        `column ${JSON.stringify(spec.options.col)} is personal data and cannot be a choice list`,
        'spec.options.col',
      );
    }
  }
  if (spec.default && spec.default.kind !== FILTER_DEFAULT_KIND[spec.control]) {
    throw new SandboxQueryError(
      `default of kind ${spec.default.kind} does not fit a ${spec.control} filter`,
      'spec.default',
    );
  }
}

/** Parses the shape, then checks every named column against the registry. */
export function validateBlockSpec(raw: unknown): BlockSpec {
  const parsed = blockSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = `spec.${issue?.path.join('.') || 'type'}`;
    throw new SandboxQueryError(`invalid ${path}: ${issue?.message ?? 'bad block'}`, path);
  }
  const spec = parsed.data;
  if (spec.type === 'filter') {
    validateFilter(spec);
    return spec;
  }
  const dataset = findDataset(spec.source.dataset);
  if (!dataset) throw new SandboxQueryError('unknown dataset', 'spec.source.dataset');

  for (const f of spec.source.filters ?? []) requireColumn(dataset, f.col, 'spec.source.filters');
  if (spec.source.period) {
    requireColumn(dataset, spec.source.period.col, 'spec.source.period.col', ['timestamp']);
  }

  switch (spec.type) {
    case 'kpi':
      requireMetric(dataset, spec.source.metric, 'spec.source.metric');
      if ((spec.compare || spec.trend) && !spec.source.period) {
        throw new SandboxQueryError('compare and trend need source.period', 'spec.source.period');
      }
      break;
    case 'chart': {
      const { dimension, time } = spec.source;
      if (!!dimension === !!time) {
        throw new SandboxQueryError(
          'set exactly one of dimension or time',
          'spec.source.dimension',
        );
      }
      if (dimension) requireColumn(dataset, dimension, 'spec.source.dimension');
      if (time) requireColumn(dataset, time.col, 'spec.source.time.col', ['timestamp']);
      spec.source.measures.forEach((m, i) =>
        requireMetric(dataset, m, `spec.source.measures.${i}`),
      );
      break;
    }
    case 'table':
      for (const name of spec.source.select ?? [])
        requireColumn(dataset, name, 'spec.source.select');
      for (const o of spec.source.orderBy ?? [])
        requireColumn(dataset, o.col, 'spec.source.orderBy');
      break;
    case 'list':
      requireColumn(dataset, spec.source.dimension, 'spec.source.dimension');
      requireMetric(dataset, spec.source.metric, 'spec.source.metric');
      break;
  }
  validateListens(spec, spec.listens);
  return spec;
}
