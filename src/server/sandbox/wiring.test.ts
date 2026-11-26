import { describe, expect, it } from 'vitest';
import { DATASETS } from './datasets';
import { pageWiring, type WiringElement } from './wiring';
import type { BlockSpec } from '$lib/sandbox/blocks/schema';

const filter = (id: string, position: number, spec: Record<string, unknown>): WiringElement => ({
  id,
  position,
  spec: { v: 1, type: 'filter', ...spec } as BlockSpec,
});

const block = (
  id: string,
  listens: Array<{ var: string; col: string }>,
  dataset = 'pos.tickets',
): WiringElement => ({
  id,
  position: 5,
  spec: {
    v: 1,
    type: 'kpi',
    source: { dataset, metric: { fn: 'count', col: '*' } },
    format: 'number',
    tone: 'accent',
    listens,
  } as BlockSpec,
});

const period = filter('f1', 0, { var: 'period', control: 'date_range' });
const status = filter('f2', 1, {
  var: 'status',
  control: 'select',
  options: { dataset: 'pos.tickets', col: 'status' },
});

describe('pageWiring (spec 150 FR-008)', () => {
  it('reports publishers and the working bindings of a connected block', () => {
    const report = pageWiring(
      [
        period,
        status,
        block('b1', [
          { var: 'period', col: 'submitted_at' },
          { var: 'status', col: 'status' },
        ]),
      ],
      DATASETS,
    );
    expect(report.publishers.map((p) => [p.var, p.control, p.colType])).toEqual([
      ['period', 'date_range', 'timestamp'],
      ['status', 'select', 'text'],
    ]);
    expect(report.blocks.b1).toEqual({
      bindings: [
        { var: 'period', col: 'submitted_at' },
        { var: 'status', col: 'status' },
      ],
      problems: [],
    });
    expect(report.duplicates).toEqual([]);
  });

  it('omits blocks without connections and lists nothing for them', () => {
    const report = pageWiring([period, block('b1', [])], DATASETS);
    expect(report.blocks).toEqual({});
  });

  it('flags no_publisher and ignores the binding', () => {
    const report = pageWiring([block('b1', [{ var: 'gone', col: 'status' }])], DATASETS);
    expect(report.blocks.b1.bindings).toEqual([]);
    expect(report.blocks.b1.problems).toMatchObject([{ var: 'gone', code: 'no_publisher' }]);
  });

  it('flags kind_mismatch: date filter on a text column, picker on a timestamp column', () => {
    const report = pageWiring(
      [
        period,
        status,
        block('b1', [
          { var: 'period', col: 'status' },
          { var: 'status', col: 'submitted_at' },
        ]),
      ],
      DATASETS,
    );
    expect(report.blocks.b1.bindings).toEqual([]);
    expect(report.blocks.b1.problems.map((p) => p.code)).toEqual([
      'kind_mismatch',
      'kind_mismatch',
    ]);
  });

  it('flags kind_mismatch when a picker choices dataset is missing', () => {
    const broken = filter('f3', 2, {
      var: 'svc',
      control: 'select',
      options: { dataset: 'gone.dataset', col: 'x' },
    });
    const report = pageWiring([broken, block('b1', [{ var: 'svc', col: 'status' }])], DATASETS);
    expect(report.publishers[0].colType).toBeNull();
    expect(report.blocks.b1.problems[0].code).toBe('kind_mismatch');
  });

  it('flags conflicting_publishers when same name differs in control or type', () => {
    const clash = filter('f9', 2, {
      var: 'period',
      control: 'select',
      options: { dataset: 'pos.tickets', col: 'status' },
    });
    const report = pageWiring(
      [period, clash, block('b1', [{ var: 'period', col: 'submitted_at' }])],
      DATASETS,
    );
    expect(report.blocks.b1.bindings).toEqual([]);
    expect(report.blocks.b1.problems[0].code).toBe('conflicting_publishers');
    expect(report.duplicates).toEqual([]);
  });

  it('treats same name + same control + same type as a valid duplicate, listing it', () => {
    const twin = filter('f8', 4, { var: 'period', control: 'date_range' });
    const report = pageWiring(
      [twin, period, block('b1', [{ var: 'period', col: 'submitted_at' }])],
      DATASETS,
    );
    expect(report.duplicates).toEqual([{ var: 'period', elementIds: ['f1', 'f8'] }]);
    expect(report.blocks.b1.bindings).toEqual([{ var: 'period', col: 'submitted_at' }]);
    expect(report.blocks.b1.problems).toEqual([]);
  });

  it('flags a stale column the dataset no longer has', () => {
    const report = pageWiring([period, block('b1', [{ var: 'period', col: 'removed' }])], DATASETS);
    expect(report.blocks.b1.problems[0].code).toBe('kind_mismatch');
  });
});
