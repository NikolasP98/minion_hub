/**
 * Pure sandbox query compiler (spec 010 FR-002, contract §1): a declarative
 * spec + a registry dataset in, one parameterized `SQL` out.
 *
 * SAFETY INVARIANTS (the whole point of this module):
 * - every identifier emitted comes from `datasets.ts` via `sql.raw`; nothing
 *   from the caller's spec is ever interpolated as SQL text. Column/dataset
 *   names are LOOKED UP, aggregate aliases are regex-validated, directions and
 *   aggregate functions are enum-matched.
 * - every value is bound as a parameter (`sql` template interpolation).
 * - `org_id = $n` is always present (RLS in `withOrgCore` is the other half).
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  columnExpr,
  findColumn,
  type ColumnType,
  type Dataset,
  type DatasetColumn,
} from './datasets';

export const OPS = [
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
export type Op = (typeof OPS)[number];

export const AGGREGATE_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

export interface QuerySpec {
  dataset: string;
  select?: string[];
  where?: Array<{ col: string; op: Op; value?: unknown }>;
  orderBy?: Array<{ col: string; dir?: 'asc' | 'desc' }>;
  limit?: number;
  groupBy?: string[];
  aggregate?: Array<{ fn: AggregateFn; col: string; as: string }>;
}

export interface OwnerScope {
  /** Registry-owned qualified SQL expression (e.g. `t.owner_id`). */
  column: string;
  profileId: string;
}

export interface CompiledColumn {
  name: string;
  type: ColumnType;
  /** Set for registry columns so the caller can mask PII; absent for aggregates. */
  pii?: boolean;
}

export interface Compiled {
  sql: SQL;
  columns: CompiledColumn[];
  limit: number;
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;
export const MAX_IN_VALUES = 100;

/** A caller-fixable problem with a query spec. `field` names the spec key. */
export class SandboxQueryError extends Error {
  readonly field: string;
  readonly status: 400 | 403;
  constructor(message: string, field: string, status: 400 | 403 = 400) {
    super(message);
    this.name = 'SandboxQueryError';
    this.field = field;
    this.status = status;
  }
}

const ALIAS_RE = /^[a-z_][a-z0-9_]*$/i;

function requireColumn(dataset: Dataset, name: unknown, field: string): DatasetColumn {
  const column = findColumn(dataset, name);
  if (!column) {
    throw new SandboxQueryError(
      `unknown column ${JSON.stringify(String(name))} for dataset ${JSON.stringify(dataset.id)}`,
      field,
    );
  }
  return column;
}

/** `%`, `_` and the escape character itself are literals in a user pattern. */
function escapeLikePattern(value: unknown): string {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

function condition(expr: SQL, entry: { col: string; op: Op; value?: unknown }): SQL {
  const { op, value } = entry;
  switch (op) {
    case 'eq':
      return sql`${expr} = ${value}`;
    case 'neq':
      return sql`${expr} <> ${value}`;
    case 'gt':
      return sql`${expr} > ${value}`;
    case 'gte':
      return sql`${expr} >= ${value}`;
    case 'lt':
      return sql`${expr} < ${value}`;
    case 'lte':
      return sql`${expr} <= ${value}`;
    case 'isNull':
      return sql`${expr} is null`;
    case 'in': {
      if (!Array.isArray(value) || value.length === 0) {
        throw new SandboxQueryError("op 'in' needs a non-empty array value", 'where');
      }
      if (value.length > MAX_IN_VALUES) {
        throw new SandboxQueryError(`op 'in' accepts at most ${MAX_IN_VALUES} values`, 'where');
      }
      return sql`${expr} in (${sql.join(
        value.map((item) => sql`${item}`),
        sql`, `,
      )})`;
    }
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new SandboxQueryError("op 'between' needs a [from, to] value", 'where');
      }
      return sql`${expr} between ${value[0]} and ${value[1]}`;
    }
    // Case-insensitive on purpose: the owner's example is `name starts with "S"`.
    case 'like':
      return sql`${expr}::text ilike ${`%${escapeLikePattern(value)}%`} escape '\\'`;
    case 'startsWith':
      return sql`${expr}::text ilike ${`${escapeLikePattern(value)}%`} escape '\\'`;
    default:
      throw new SandboxQueryError('unknown op', 'where');
  }
}

function aggregateType(fn: AggregateFn, column: DatasetColumn | null): ColumnType {
  if (fn === 'min' || fn === 'max') return column?.type ?? 'text';
  return 'number';
}

function parseDefaultOrder(dataset: Dataset): SQL {
  const [name, dir] = dataset.defaultOrder.trim().split(/\s+/);
  const column = requireColumn(dataset, name, 'defaultOrder');
  return sql`${sql.raw(columnExpr(column))} ${sql.raw(dir === 'desc' ? 'desc' : 'asc')}`;
}

export function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/**
 * Compile `spec` against `dataset`. `groupBy` switches the projection to
 * "group columns + aggregates" — a `select` is then ignored, because the only
 * columns a grouped query can return are those two sets.
 */
export function compile(
  spec: QuerySpec,
  dataset: Dataset,
  scope: { orgId: string; ownerScope?: OwnerScope; restrictPii?: boolean },
): Compiled {
  // When the caller's field level masks PII, a masked column may still be
  // SELECTED (it comes back as '***') but never filtered, grouped, ordered or
  // aggregated — each of those turns the hidden value into an observable.
  const guardPii = (column: DatasetColumn | null, field: string) => {
    if (scope.restrictPii && column?.pii) {
      throw new SandboxQueryError(
        `column ${JSON.stringify(column.name)} is restricted for your role`,
        field,
        403,
      );
    }
  };
  const grouped = Array.isArray(spec.groupBy) && spec.groupBy.length > 0;
  const aggregates = spec.aggregate ?? [];

  const projection: SQL[] = [];
  const columns: CompiledColumn[] = [];
  const aliasTypes = new Map<string, ColumnType>();

  if (grouped) {
    for (const name of spec.groupBy ?? []) {
      const column = requireColumn(dataset, name, 'groupBy');
      guardPii(column, 'groupBy');
      projection.push(sql`${sql.raw(columnExpr(column))} as ${sql.raw(`"${column.name}"`)}`);
      columns.push({ name: column.name, type: column.type, ...(column.pii ? { pii: true } : {}) });
    }
  } else {
    const names = spec.select?.length ? spec.select : dataset.defaultColumns;
    for (const name of names) {
      const column = requireColumn(dataset, name, 'select');
      projection.push(sql`${sql.raw(columnExpr(column))} as ${sql.raw(`"${column.name}"`)}`);
      columns.push({ name: column.name, type: column.type, ...(column.pii ? { pii: true } : {}) });
    }
  }

  for (const entry of aggregates) {
    if (!AGGREGATE_FNS.includes(entry?.fn)) {
      throw new SandboxQueryError(
        `unknown aggregate ${JSON.stringify(String(entry?.fn))}`,
        'aggregate',
      );
    }
    if (typeof entry.as !== 'string' || !ALIAS_RE.test(entry.as)) {
      throw new SandboxQueryError(
        `invalid aggregate alias ${JSON.stringify(String(entry?.as))}`,
        'aggregate',
      );
    }
    // count(*) is the only starred aggregate; every other fn needs a column.
    const starred = entry.fn === 'count' && entry.col === '*';
    const column = starred ? null : requireColumn(dataset, entry.col, 'aggregate');
    guardPii(column, 'aggregate');
    const inner = starred ? sql.raw('*') : sql.raw(columnExpr(column!));
    projection.push(
      sql`${sql.raw(entry.fn)}(${inner})${sql.raw(entry.fn === 'count' ? '::int' : '')} as ${sql.raw(`"${entry.as}"`)}`,
    );
    const type = aggregateType(entry.fn, column);
    // min/max of a PII column IS that column's value; the mask must follow it.
    const piiAgg = !!column?.pii && (entry.fn === 'min' || entry.fn === 'max');
    columns.push({ name: entry.as, type, ...(piiAgg ? { pii: true } : {}) });
    aliasTypes.set(entry.as, type);
  }

  if (projection.length === 0) {
    throw new SandboxQueryError('a query must select or aggregate at least one column', 'select');
  }

  let query = sql`select ${sql.join(projection, sql`, `)} from ${sql.raw(dataset.from)} where ${sql.raw(dataset.orgColumn)} = ${scope.orgId}`;

  if (scope.ownerScope) {
    query = sql`${query} and ${sql.raw(scope.ownerScope.column)} = ${scope.ownerScope.profileId}`;
  }

  for (const entry of spec.where ?? []) {
    if (!OPS.includes(entry?.op)) throw new SandboxQueryError('unknown op', 'where');
    const column = requireColumn(dataset, entry.col, 'where');
    guardPii(column, 'where');
    query = sql`${query} and ${condition(sql.raw(columnExpr(column)), entry)}`;
  }

  if (grouped) {
    const groupExprs = (spec.groupBy ?? []).map((name) =>
      sql.raw(columnExpr(requireColumn(dataset, name, 'groupBy'))),
    );
    query = sql`${query} group by ${sql.join(groupExprs, sql`, `)}`;
  }

  const orderBy = spec.orderBy ?? [];
  if (orderBy.length > 0) {
    const terms = orderBy.map((entry) => {
      const dir = sql.raw(entry.dir === 'desc' ? 'desc' : 'asc');
      // An aggregate alias is the only non-registry identifier allowed here,
      // and it was validated against ALIAS_RE when the aggregate was compiled.
      if (aliasTypes.has(entry.col)) return sql`${sql.raw(`"${entry.col}"`)} ${dir}`;
      const column = requireColumn(dataset, entry.col, 'orderBy');
      guardPii(column, 'orderBy');
      if (grouped && !(spec.groupBy ?? []).includes(column.name)) {
        throw new SandboxQueryError(
          `orderBy column ${JSON.stringify(column.name)} must be grouped or aggregated`,
          'orderBy',
        );
      }
      return sql`${sql.raw(columnExpr(column))} ${dir}`;
    });
    query = sql`${query} order by ${sql.join(terms, sql`, `)}`;
  } else if (!grouped) {
    query = sql`${query} order by ${parseDefaultOrder(dataset)}`;
  }

  const limit = clampLimit(spec.limit);
  query = sql`${query} limit ${limit}`;

  return { sql: query, columns, limit };
}
