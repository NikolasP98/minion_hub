import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { findDataset, type Dataset } from './datasets';
import {
  compile,
  clampLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SandboxQueryError,
  type Op,
  type QuerySpec,
} from './query-compiler';

const dialect = new PgDialect();

function dataset(id: string): Dataset {
  const found = findDataset(id);
  if (!found) throw new Error(`test fixture: unknown dataset ${id}`);
  return found;
}

function render(
  spec: QuerySpec,
  datasetId = spec.dataset,
  ownerScope?: { column: string; profileId: string },
) {
  const compiled = compile(spec, dataset(datasetId), { orgId: 'org-1', ownerScope });
  const query = dialect.sqlToQuery(compiled.sql);
  return { sql: query.sql, params: query.params, columns: compiled.columns, limit: compiled.limit };
}

describe('compile — projection and scoping', () => {
  it('selects the registry default columns, default order, default limit and binds the org id', () => {
    const out = render({ dataset: 'crm.contacts' });
    expect(out.sql).toBe(
      'select t.display_name as "display_name", t.source as "source", t.created_at as "created_at" ' +
        'from crm_contacts t where t.org_id = $1 order by t.created_at desc limit $2',
    );
    expect(out.params).toEqual(['org-1', DEFAULT_LIMIT]);
    expect(out.columns).toEqual([
      { name: 'display_name', type: 'text' },
      { name: 'source', type: 'text' },
      { name: 'created_at', type: 'timestamp' },
    ]);
  });

  it('emits the joined expressions for a dataset whose base SQL joins', () => {
    const out = render({
      dataset: 'pos.ticket_lines',
      select: ['product_name', 'total', 'ticket_status'],
    });
    expect(out.sql).toContain('coalesce(p.name, t.description) as "product_name"');
    expect(out.sql).toContain('tk.status as "ticket_status"');
    expect(out.sql).toContain(
      'join pos_tickets tk on tk.id = t.ticket_id and tk.org_id = t.org_id',
    );
  });

  it('flags PII columns on the compiled column list (the masking input)', () => {
    const out = render({ dataset: 'pos.tickets', select: ['customer_name', 'total'] });
    expect(out.columns).toEqual([
      { name: 'customer_name', type: 'text', pii: true },
      { name: 'total', type: 'number' },
    ]);
  });

  it('adds the owner predicate with the profile id bound', () => {
    const out = render({ dataset: 'crm.contacts', select: ['display_name'] }, 'crm.contacts', {
      column: 't.owner_id',
      profileId: 'profile-9',
    });
    expect(out.sql).toContain('where t.org_id = $1 and t.owner_id = $2');
    expect(out.params).toEqual(['org-1', 'profile-9', DEFAULT_LIMIT]);
  });
});

describe('compile — one case per op', () => {
  const cases: Array<{ op: Op; value?: unknown; fragment: string; params: unknown[] }> = [
    {
      op: 'eq',
      value: 'S',
      fragment: 't.display_name = $2',
      params: ['org-1', 'S', DEFAULT_LIMIT],
    },
    {
      op: 'neq',
      value: 'S',
      fragment: 't.display_name <> $2',
      params: ['org-1', 'S', DEFAULT_LIMIT],
    },
    {
      op: 'gt',
      value: 'a',
      fragment: 't.display_name > $2',
      params: ['org-1', 'a', DEFAULT_LIMIT],
    },
    {
      op: 'gte',
      value: 'a',
      fragment: 't.display_name >= $2',
      params: ['org-1', 'a', DEFAULT_LIMIT],
    },
    {
      op: 'lt',
      value: 'z',
      fragment: 't.display_name < $2',
      params: ['org-1', 'z', DEFAULT_LIMIT],
    },
    {
      op: 'lte',
      value: 'z',
      fragment: 't.display_name <= $2',
      params: ['org-1', 'z', DEFAULT_LIMIT],
    },
    {
      op: 'in',
      value: ['a', 'b'],
      fragment: 't.display_name in ($2, $3)',
      params: ['org-1', 'a', 'b', DEFAULT_LIMIT],
    },
    {
      op: 'between',
      value: ['a', 'z'],
      fragment: 't.display_name between $2 and $3',
      params: ['org-1', 'a', 'z', DEFAULT_LIMIT],
    },
    {
      op: 'like',
      value: 'eva',
      fragment: `t.display_name::text ilike $2 escape '\\'`,
      params: ['org-1', '%eva%', DEFAULT_LIMIT],
    },
    {
      op: 'startsWith',
      value: 'S',
      fragment: `t.display_name::text ilike $2 escape '\\'`,
      params: ['org-1', 'S%', DEFAULT_LIMIT],
    },
    { op: 'isNull', fragment: 't.display_name is null', params: ['org-1', DEFAULT_LIMIT] },
  ];

  it.each(cases)(
    'compiles op $op to a parameterized predicate',
    ({ op, value, fragment, params }) => {
      const out = render({
        dataset: 'crm.contacts',
        select: ['display_name'],
        where: [{ col: 'display_name', op, value }],
      });
      expect(out.sql).toContain(fragment);
      expect(out.params).toEqual(params);
    },
  );

  it('ANDs several conditions — the owner scenario (name starts with S, born 2000+)', () => {
    const out = render({
      dataset: 'crm.contacts',
      select: ['display_name', 'created_at'],
      where: [
        { col: 'display_name', op: 'startsWith', value: 'S' },
        { col: 'created_at', op: 'gte', value: '2000-01-01' },
      ],
      limit: 50,
    });
    expect(out.sql).toContain(
      `where t.org_id = $1 and t.display_name::text ilike $2 escape '\\' and t.created_at >= $3`,
    );
    expect(out.params).toEqual(['org-1', 'S%', '2000-01-01', 50]);
  });
});

describe('compile — like/startsWith escaping', () => {
  it('escapes %, _ and backslash so a wildcard typed by a user stays a literal', () => {
    const out = render({
      dataset: 'crm.contacts',
      select: ['display_name'],
      where: [{ col: 'display_name', op: 'like', value: '100%_a\\b' }],
    });
    expect(out.params[1]).toBe('%100\\%\\_a\\\\b%');
  });

  it('anchors startsWith at the front only', () => {
    const out = render({
      dataset: 'crm.contacts',
      select: ['display_name'],
      where: [{ col: 'display_name', op: 'startsWith', value: '50%' }],
    });
    expect(out.params[1]).toBe('50\\%%');
  });
});

describe('compile — groupBy + aggregate', () => {
  it('projects group columns plus aggregate aliases and groups by the registry expressions', () => {
    const out = render({
      dataset: 'pos.ticket_lines',
      groupBy: ['product_name'],
      aggregate: [
        { fn: 'sum', col: 'total', as: 'revenue' },
        { fn: 'count', col: '*', as: 'lines' },
      ],
      orderBy: [{ col: 'revenue', dir: 'desc' }],
      where: [{ col: 'ticket_status', op: 'eq', value: 'submitted' }],
    });
    expect(out.sql).toBe(
      'select coalesce(p.name, t.description) as "product_name", sum(t.total) as "revenue", count(*)::int as "lines" ' +
        'from pos_ticket_lines t join pos_tickets tk on tk.id = t.ticket_id and tk.org_id = t.org_id ' +
        'left join fin_products p on p.id = t.fin_product_id and p.org_id = t.org_id ' +
        'where t.org_id = $1 and tk.status = $2 group by coalesce(p.name, t.description) order by "revenue" desc limit $3',
    );
    expect(out.params).toEqual(['org-1', 'submitted', DEFAULT_LIMIT]);
    expect(out.columns).toEqual([
      { name: 'product_name', type: 'text' },
      { name: 'revenue', type: 'number' },
      { name: 'lines', type: 'number' },
    ]);
  });

  it('aggregates without groupBy produce one row and no order clause by default', () => {
    const out = render({
      dataset: 'pos.tickets',
      select: [],
      aggregate: [{ fn: 'sum', col: 'total', as: 'gross' }],
    });
    expect(out.sql).toBe(
      'select t.human_id as "human_id", t.status as "status", t.total as "total", ' +
        't.submitted_at as "submitted_at", sum(t.total) as "gross" from pos_tickets t ' +
        'where t.org_id = $1 order by t.submitted_at desc limit $2',
    );
  });

  it('min/max keep the source column type; count/sum/avg are numbers', () => {
    const out = render({
      dataset: 'pos.tickets',
      groupBy: ['status'],
      aggregate: [
        { fn: 'max', col: 'submitted_at', as: 'last_sale' },
        { fn: 'avg', col: 'total', as: 'avg_total' },
      ],
    });
    expect(out.columns).toEqual([
      { name: 'status', type: 'text' },
      { name: 'last_sale', type: 'timestamp' },
      { name: 'avg_total', type: 'number' },
    ]);
  });

  it('rejects an ungrouped, unaggregated orderBy column on a grouped query', () => {
    expect(() =>
      render({
        dataset: 'pos.tickets',
        groupBy: ['status'],
        aggregate: [{ fn: 'count', col: '*', as: 'n' }],
        orderBy: [{ col: 'total' }],
      }),
    ).toThrow(/must be grouped or aggregated/);
  });

  it('rejects an aggregate alias that is not a bare identifier', () => {
    expect(() =>
      render({
        dataset: 'pos.tickets',
        groupBy: ['status'],
        aggregate: [{ fn: 'count', col: '*', as: 'n"; drop table pos_tickets --' }],
      }),
    ).toThrow(SandboxQueryError);
  });
});

describe('compile — limit clamping', () => {
  it('clamps above the maximum and below 1, and defaults for non-numbers', () => {
    expect(render({ dataset: 'pos.tickets', limit: 99_999 }).limit).toBe(MAX_LIMIT);
    expect(render({ dataset: 'pos.tickets', limit: 0 }).limit).toBe(1);
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_LIMIT);
    expect(clampLimit('500' as unknown)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(250.7)).toBe(250);
  });

  it('binds the clamped limit, never the requested one', () => {
    const out = render({ dataset: 'pos.tickets', limit: 5000 });
    expect(out.params.at(-1)).toBe(MAX_LIMIT);
  });
});

describe('compile — named 400s', () => {
  it('names an unknown column and the dataset it was asked of', () => {
    expect(() => render({ dataset: 'crm.contacts', select: ['salary'] })).toThrow(
      'unknown column "salary" for dataset "crm.contacts"',
    );
    try {
      render({ dataset: 'crm.contacts', select: ['salary'] });
    } catch (e) {
      expect(e).toBeInstanceOf(SandboxQueryError);
      expect((e as SandboxQueryError).field).toBe('select');
      expect((e as SandboxQueryError).status).toBe(400);
    }
  });

  it('names the field for an unknown column in where / orderBy / groupBy / aggregate', () => {
    const fields: Array<[QuerySpec, string]> = [
      [{ dataset: 'crm.contacts', where: [{ col: 'nope', op: 'eq', value: 1 }] }, 'where'],
      [{ dataset: 'crm.contacts', orderBy: [{ col: 'nope' }] }, 'orderBy'],
      [{ dataset: 'crm.contacts', groupBy: ['nope'] }, 'groupBy'],
      [{ dataset: 'crm.contacts', aggregate: [{ fn: 'sum', col: 'nope', as: 'x' }] }, 'aggregate'],
    ];
    for (const [spec, field] of fields) {
      try {
        render(spec);
        throw new Error(`expected ${field} to throw`);
      } catch (e) {
        expect(e, field).toBeInstanceOf(SandboxQueryError);
        expect((e as SandboxQueryError).field).toBe(field);
      }
    }
  });

  it('rejects an unknown op without emitting SQL', () => {
    expect(() =>
      render({
        dataset: 'crm.contacts',
        where: [{ col: 'display_name', op: 'regex' as Op, value: '.*' }],
      }),
    ).toThrow('unknown op');
  });

  it('rejects an unknown aggregate function', () => {
    expect(() =>
      render({
        dataset: 'pos.tickets',
        groupBy: ['status'],
        aggregate: [{ fn: 'median' as never, col: 'total', as: 'm' }],
      }),
    ).toThrow(/unknown aggregate/);
  });

  it('rejects more than 100 values in an `in` list', () => {
    const value = Array.from({ length: 101 }, (_, i) => `v${i}`);
    expect(() =>
      render({ dataset: 'crm.contacts', where: [{ col: 'display_name', op: 'in', value }] }),
    ).toThrow("op 'in' accepts at most 100 values");
    expect(() =>
      render({
        dataset: 'crm.contacts',
        where: [{ col: 'display_name', op: 'in', value: value.slice(0, 100) }],
      }),
    ).not.toThrow();
  });

  it('rejects an empty in list and a malformed between', () => {
    expect(() =>
      render({ dataset: 'crm.contacts', where: [{ col: 'display_name', op: 'in', value: [] }] }),
    ).toThrow(/non-empty array/);
    expect(() =>
      render({ dataset: 'pos.tickets', where: [{ col: 'total', op: 'between', value: 5 }] }),
    ).toThrow(/\[from, to\]/);
  });
});

describe('registry', () => {
  it('has no dataset for an unknown id', () => {
    expect(findDataset('crm.salaries')).toBeUndefined();
    expect(findDataset(42)).toBeUndefined();
  });

  it('every dataset default order and default column resolves to a declared column', () => {
    for (const ds of [
      'crm.contacts',
      'pos.tickets',
      'pos.ticket_lines',
      'pos.payments',
      'finance.invoices',
      'finance.products',
      'scheduling.bookings',
      'stock.items',
    ]) {
      expect(() => render({ dataset: ds }), ds).not.toThrow();
    }
  });
});

describe('compile — PII side channels are closed when the caller is masked (security review 2026-10-16)', () => {
  const masked = (spec: QuerySpec) =>
    compile(spec, dataset(spec.dataset), { orgId: 'org-1', restrictPii: true });
  it('refuses where / orderBy / groupBy / aggregate on a PII column with 403', () => {
    const piiWhere: QuerySpec = {
      dataset: 'pos.tickets',
      where: [{ col: 'customer_name', op: 'startsWith', value: 'S' }],
    };
    const piiOrder: QuerySpec = { dataset: 'pos.tickets', orderBy: [{ col: 'customer_name' }] };
    const piiGroup: QuerySpec = {
      dataset: 'pos.tickets',
      groupBy: ['customer_name'],
      aggregate: [{ fn: 'count', col: '*', as: 'n' }],
    };
    const piiAgg: QuerySpec = {
      dataset: 'pos.tickets',
      aggregate: [{ fn: 'max', col: 'customer_name', as: 'last' }],
    };
    for (const spec of [piiWhere, piiOrder, piiGroup, piiAgg]) {
      let caught: unknown;
      try {
        masked(spec);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SandboxQueryError);
      expect((caught as SandboxQueryError).status).toBe(403);
      expect((caught as SandboxQueryError).message).toContain('"customer_name" is restricted');
    }
  });
  it('still allows SELECTING the PII column (it is masked in the result) and non-PII filters', () => {
    const out = masked({
      dataset: 'pos.tickets',
      select: ['customer_name', 'total'],
      where: [{ col: 'total', op: 'gte', value: 10 }],
    });
    expect(out.columns.map((c) => c.name)).toEqual(['customer_name', 'total']);
  });
  it('propagates the PII flag through min/max for an unmasked caller so the service can still mask', () => {
    const out = compile(
      { dataset: 'pos.tickets', aggregate: [{ fn: 'max', col: 'customer_name', as: 'last' }] },
      dataset('pos.tickets'),
      { orgId: 'org-1' },
    );
    expect(out.columns.find((c) => c.name === 'last')).toEqual({
      name: 'last',
      type: 'text',
      pii: true,
    });
  });
});
