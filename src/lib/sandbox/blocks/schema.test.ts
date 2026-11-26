import { describe, expect, it } from 'vitest';
import {
  BLOCK_KINDS,
  CHART_PRESETS,
  FORMATS,
  RANGES,
  blockSpecSchema,
  blockToolSchemas,
  filterToolSchema,
  isDataBlock,
  parseBlockSpec,
} from './schema';

const kpi = {
  v: 1,
  type: 'kpi',
  source: {
    dataset: 'pos.tickets',
    metric: { fn: 'sum', col: 'total' },
    period: { col: 'submitted_at', range: 'this_month' },
  },
  format: 'money',
  compare: true,
};

describe('block grammar (spec 049)', () => {
  it('parses a kpi spec and fills the preset defaults', () => {
    const spec = parseBlockSpec(kpi);
    expect(spec.type).toBe('kpi');
    if (spec.type !== 'kpi') return;
    expect(spec.tone).toBe('accent');
    expect(spec.format).toBe('money');
  });

  it('rejects an unknown preset, kind, range or format with a path', () => {
    const bad = (raw: unknown) => {
      try {
        parseBlockSpec(raw);
      } catch (err) {
        return (err as { issues: Array<{ path: unknown[] }> }).issues
          .map((i) => i.path.join('.'))
          .join(',');
      }
      return '';
    };
    expect(bad({ ...kpi, format: 'currency' })).toBe('format');
    expect(bad({ ...kpi, type: 'gauge' })).toBe('type');
    expect(
      bad({ ...kpi, source: { ...kpi.source, period: { col: 'x', range: 'last_year' } } }),
    ).toContain('range');
    expect(
      bad({ v: 1, type: 'chart', preset: 'radar', source: { dataset: 'd', measures: [] } }),
    ).toContain('preset');
  });

  it('exposes one tool schema per kind, derived from the same grammar', () => {
    const tools = blockToolSchemas();
    expect(tools.map((t) => t.kind)).toEqual([...BLOCK_KINDS]);
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        required?: string[];
        properties: Record<string, unknown>;
      };
      expect(schema.required).toEqual(expect.arrayContaining(['title', 'source']));
      expect(schema.required).not.toContain('id');
      expect(schema.required).not.toContain('format');
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(['id', 'title', 'w', 'h']),
      );
      expect(schema).not.toHaveProperty('$schema');
    }
    const chart = tools.find((t) => t.kind === 'chart')!;
    expect(JSON.stringify(chart.inputSchema)).toContain(JSON.stringify([...CHART_PRESETS]));
    expect(JSON.stringify(chart.inputSchema)).toContain(JSON.stringify([...FORMATS]));
    expect(JSON.stringify(chart.inputSchema)).toContain(JSON.stringify([...RANGES]));
  });

  it('a tool input parses into the stored spec shape with v/type added', () => {
    const list = blockToolSchemas().find((t) => t.kind === 'list')!;
    const out = list.parse({
      title: 'Top products',
      w: 2,
      source: {
        dataset: 'pos.ticket_lines',
        dimension: 'product_name',
        metric: { fn: 'sum', col: 'total' },
      },
      format: 'money',
    });
    expect(out.title).toBe('Top products');
    expect(out.w).toBe(2);
    expect(out.spec).toMatchObject({ v: 1, type: 'list', format: 'money' });
    expect(out.spec.type === 'list' && out.spec.source.limit).toBe(8);
  });
});

describe('filters and connections (spec 150)', () => {
  const filter = { v: 1, type: 'filter', var: 'period', control: 'date_range' };

  it('keeps BLOCK_KINDS and the block tools data-only', () => {
    expect([...BLOCK_KINDS]).toEqual(['kpi', 'chart', 'table', 'list']);
    expect(blockToolSchemas().map((t) => t.kind)).toEqual([...BLOCK_KINDS]);
  });

  it('parses a filter with a default and narrows with isDataBlock', () => {
    const spec = blockSpecSchema.parse({ ...filter, default: { kind: 'date', range: 'last_30d' } });
    expect(spec.type).toBe('filter');
    expect(isDataBlock(spec)).toBe(false);
    expect(isDataBlock(blockSpecSchema.parse(kpi))).toBe(true);
    expect(isDataBlock(null)).toBe(false);
  });

  it('accepts select / multi defaults and caps a multi at 100 values', () => {
    expect(() =>
      blockSpecSchema.parse({
        v: 1,
        type: 'filter',
        var: 'status',
        control: 'multi_select',
        options: { dataset: 'pos.tickets', col: 'status' },
        default: { kind: 'multi', values: ['void'] },
      }),
    ).not.toThrow();
    expect(() =>
      blockSpecSchema.parse({
        ...filter,
        default: { kind: 'multi', values: Array.from({ length: 101 }, (_, i) => String(i)) },
      }),
    ).toThrow();
  });

  it('refuses a value name that is not a short lowercase word', () => {
    for (const bad of ['Period', '1x', 'a-b', '', 'x'.repeat(33)]) {
      expect(() => blockSpecSchema.parse({ ...filter, var: bad }), bad).toThrow();
    }
    expect(() => blockSpecSchema.parse({ ...filter, var: 'x'.repeat(32) })).not.toThrow();
  });

  it('accepts listens on every data kind, at most 6, and has no default', () => {
    const listens = [{ var: 'period', col: 'submitted_at' }];
    const spec = blockSpecSchema.parse({ ...kpi, listens });
    expect(spec.type === 'kpi' && spec.listens).toEqual(listens);
    const plain = blockSpecSchema.parse(kpi);
    expect('listens' in plain).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => ({ var: `v${i}`, col: 'total' }));
    expect(() => blockSpecSchema.parse({ ...kpi, listens: seven })).toThrow();
    expect(() => blockSpecSchema.parse({ ...kpi, listens: [{ var: 'Bad', col: 'x' }] })).toThrow();
  });

  it('derives the filter tool from the grammar: envelope id + title, no w/h', () => {
    const tool = filterToolSchema();
    const schema = tool.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['id', 'title', 'var', 'control', 'options', 'default']),
    );
    expect(schema.properties).not.toHaveProperty('w');
    expect(schema.required).toEqual(expect.arrayContaining(['title', 'var', 'control']));
    const parsed = tool.parse({ title: 'Period', var: 'period', control: 'date_range' });
    expect(parsed.spec).toMatchObject({ v: 1, type: 'filter', var: 'period' });
  });
});
