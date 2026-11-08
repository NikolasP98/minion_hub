/**
 * Registry-aware block validation (spec 049 I4). The shared zod grammar checks
 * SHAPE; this checks that every column a block names exists on its dataset
 * with a type the role needs (a number for sum/avg, a timestamp for
 * period/bucket), so a bad spec is a 400 naming the field at write time
 * instead of a blank block at render time.
 */
import { blockSpecSchema, type BlockSpec } from '$lib/sandbox/blocks/schema';
import { findColumn, findDataset, type ColumnType, type Dataset } from './datasets';
import { SandboxQueryError } from './query-compiler';

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

/** Parses the shape, then checks every named column against the registry. */
export function validateBlockSpec(raw: unknown): BlockSpec {
  const parsed = blockSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = `spec.${issue?.path.join('.') || 'type'}`;
    throw new SandboxQueryError(`invalid ${path}: ${issue?.message ?? 'bad block'}`, path);
  }
  const spec = parsed.data;
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
  return spec;
}
