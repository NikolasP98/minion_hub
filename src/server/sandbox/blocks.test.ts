import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BLOCK_EXAMPLES } from '$lib/sandbox/blocks/catalog';
import { blockQueries } from '$lib/sandbox/blocks/query';
import { dataBlockSpecSchema } from '$lib/sandbox/blocks/schema';
import { validateBlockSpec } from './blocks';
import { findDataset } from './datasets';
import { compile, SandboxQueryError, type QuerySpec } from './query-compiler';

const kpi = {
  v: 1,
  type: 'kpi',
  source: {
    dataset: 'pos.tickets',
    metric: { fn: 'sum', col: 'total' },
    period: { col: 'submitted_at', range: 'this_month' },
  },
};

/** The `field` a refusal names, or null when the spec is accepted. */
function refused(raw: unknown): string | null {
  try {
    validateBlockSpec(raw);
  } catch (err) {
    if (err instanceof SandboxQueryError) return err.field;
    throw err;
  }
  return null;
}

describe('connections (listens) — spec 150 FR-007', () => {
  it('accepts a connection to a real, non-PII column', () => {
    expect(refused({ ...kpi, listens: [{ var: 'period', col: 'submitted_at' }] })).toBeNull();
  });

  it('refuses a column the dataset lacks, naming spec.listens.<i>.col', () => {
    expect(
      refused({
        ...kpi,
        listens: [
          { var: 'a', col: 'status' },
          { var: 'b', col: 'nope' },
        ],
      }),
    ).toBe('spec.listens.1.col');
  });

  it('refuses a personal-data column', () => {
    expect(refused({ ...kpi, listens: [{ var: 'who', col: 'customer_name' }] })).toBe(
      'spec.listens.0.col',
    );
  });

  it('refuses a value name that is not a short lowercase word, naming spec.listens.<i>.var', () => {
    expect(refused({ ...kpi, listens: [{ var: 'Period', col: 'status' }] })).toBe(
      'spec.listens.0.var',
    );
  });

  it('refuses a duplicate value name', () => {
    expect(
      refused({
        ...kpi,
        listens: [
          { var: 'a', col: 'status' },
          { var: 'a', col: 'currency' },
        ],
      }),
    ).toBe('spec.listens.1.var');
  });

  it('refuses more than 6 connections', () => {
    const listens = Array.from({ length: 7 }, (_, i) => ({ var: `v${i}`, col: 'status' }));
    expect(refused({ ...kpi, listens })).toBe('spec.listens');
  });

  it('refuses when filters + period + connections exceed 20 where entries', () => {
    // 10 own filters + period (2) = 12; six timestamp connections add 12 -> 24 > 20
    const filters = Array.from({ length: 10 }, () => ({ col: 'status', op: 'eq', value: 'void' }));
    const listens = Array.from({ length: 6 }, (_, i) => ({ var: `d${i}`, col: 'submitted_at' }));
    expect(refused({ ...kpi, source: { ...kpi.source, filters }, listens })).toBe('spec.listens');
    // exactly at the limit passes: 12 + 4 timestamp (8) = 20
    expect(
      refused({ ...kpi, source: { ...kpi.source, filters }, listens: listens.slice(0, 4) }),
    ).toBeNull();
  });
});

describe('filter elements — spec 150 FR-007', () => {
  const date = { v: 1, type: 'filter', var: 'period', control: 'date_range' };
  const pick = {
    v: 1,
    type: 'filter',
    var: 'status',
    control: 'select',
    options: { dataset: 'pos.tickets', col: 'status' },
  };

  it('accepts a date filter and pickers', () => {
    expect(refused(date)).toBeNull();
    expect(refused(pick)).toBeNull();
    expect(refused({ ...pick, control: 'multi_select' })).toBeNull();
  });

  it('refuses a bad value name naming spec.var', () => {
    expect(refused({ ...date, var: 'Bad Name' })).toBe('spec.var');
  });

  it('refuses options on a date filter, and a picker without options', () => {
    expect(refused({ ...date, options: pick.options })).toBe('spec.options');
    expect(refused({ ...pick, options: undefined })).toBe('spec.options');
  });

  it('refuses an unknown or personal-data choice column naming spec.options.col', () => {
    expect(refused({ ...pick, options: { dataset: 'pos.tickets', col: 'nope' } })).toBe(
      'spec.options.col',
    );
    expect(refused({ ...pick, options: { dataset: 'pos.tickets', col: 'customer_name' } })).toBe(
      'spec.options.col',
    );
  });

  it('refuses an unknown choice dataset', () => {
    expect(refused({ ...pick, options: { dataset: 'nope', col: 'x' } })).toBe(
      'spec.options.dataset',
    );
  });

  it('refuses a default that does not match the control, naming spec.default', () => {
    expect(refused({ ...date, default: { kind: 'select', value: 'x' } })).toBe('spec.default');
    expect(refused({ ...pick, default: { kind: 'date', range: 'today' } })).toBe('spec.default');
    expect(refused({ ...date, default: { kind: 'date', range: 'last_30d' } })).toBeNull();
  });

  it('refuses a picker default that does not fit the choices column type', () => {
    const num = { ...pick, options: { dataset: 'pos.tickets', col: 'total' } };
    expect(refused({ ...num, default: { kind: 'select', value: 'abc' } })).toBe('spec.default');
    expect(refused({ ...num, default: { kind: 'select', value: 12 } })).toBeNull();
    expect(
      refused({
        ...num,
        control: 'multi_select',
        default: { kind: 'multi', values: [1, 'abc'] },
      }),
    ).toBe('spec.default');
    expect(refused({ ...pick, default: { kind: 'select', value: 'void' } })).toBeNull();
  });
});

describe('every filter in BLOCK_EXAMPLES compiles (SC-008)', () => {
  const dialect = new PgDialect();
  it.each(Object.entries(BLOCK_EXAMPLES))('%s example', (kind, example) => {
    const spec = dataBlockSpecSchema.parse({ v: 1, type: kind, ...example });
    const q = blockQueries(spec, new Date(2026, 10, 25));
    const queries = 'rows' in q ? [q.rows] : [q.value, q.compare, q.trend];
    for (const query of queries) {
      if (!query) continue;
      const dataset = findDataset(query.dataset)!;
      expect(() =>
        dialect.sqlToQuery(compile(query as QuerySpec, dataset, { orgId: 'org-1' }).sql),
      ).not.toThrow();
    }
  });
});
