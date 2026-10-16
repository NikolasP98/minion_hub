/**
 * Sandbox data layer (spec 010 FR-003/FR-007): the RBAC + RLS wrapper around
 * the pure query compiler, and CRUD for the user-authored elements.
 *
 * Every read goes through the SAME gates as the human UI path —
 * `hasOrgCapability(module,'view')`, `resolveOwnerScope`, `shouldMaskSensitive`
 * and `withOrgCore` (RLS) — so one generic endpoint stays exactly as safe as
 * the bespoke routes it replaces.
 */
import { sql } from 'drizzle-orm';
import { requireCoreCtx, type CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import {
  hasOrgCapability,
  resolveOwnerScope,
  shouldMaskSensitive,
} from '$server/services/rbac.service';
import { DATASETS, datasetCatalogEntry, findDataset, type Dataset } from './datasets';
import { compile, SandboxQueryError, type QuerySpec } from './query-compiler';

/** Shown to an element whose author may not read a sensitive column. */
export const MASKED = '***';

const QUERY_TIMEOUT_MS = 5000;
/** html + css + js, per contract §3. */
export const ELEMENT_MAX_BYTES = 64 * 1024;

export interface QueryResult {
  dataset: string;
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  /** True when the row count hit the (clamped) limit — there may be more. */
  limited: boolean;
  elapsedMs: number;
}

/** The datasets whose RBAC module the caller may `view`. */
export async function listDatasets(locals: App.Locals) {
  const allowed: ReturnType<typeof datasetCatalogEntry>[] = [];
  for (const dataset of DATASETS) {
    if (await hasOrgCapability(locals, dataset.module, 'view')) {
      allowed.push(datasetCatalogEntry(dataset));
    }
  }
  return allowed;
}

async function requireDatasetView(locals: App.Locals, spec: QuerySpec): Promise<Dataset> {
  const dataset = findDataset(spec?.dataset);
  if (!dataset) throw new SandboxQueryError('unknown dataset', 'dataset');
  if (!(await hasOrgCapability(locals, dataset.module, 'view'))) {
    throw new SandboxQueryError(
      `Your role does not permit 'view' on ${dataset.module}.`,
      'dataset',
      403,
    );
  }
  return dataset;
}

export async function runQuery(locals: App.Locals, spec: QuerySpec): Promise<QueryResult> {
  const dataset = await requireDatasetView(locals, spec);
  const ctx = await requireCoreCtx(locals);

  // Record-level scoping uses the REGISTRY's owner expression, not the column
  // name rbac.service reports — the registry is the only identifier source.
  const owner = await resolveOwnerScope(locals, dataset.module);
  const ownerScope =
    owner.scoped && dataset.ownerColumn && owner.profileId
      ? { column: dataset.ownerColumn, profileId: owner.profileId }
      : undefined;

  const compiled = compile(spec, dataset, { orgId: ctx.tenantId, ownerScope });
  const mask = await shouldMaskSensitive(locals, dataset.module);
  const piiColumns = mask ? compiled.columns.filter((c) => c.pii).map((c) => c.name) : [];

  const startedAt = performance.now();
  const rows = await withOrgCore(ctx, async (tx) => {
    // A sandbox element is user-authored and may ask for an expensive shape;
    // 5 s keeps one bad query from holding the RLS connection.
    await tx.execute(
      sql`select set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, true)`,
    );
    return (await tx.execute(compiled.sql)) as unknown as Record<string, unknown>[];
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (piiColumns.length > 0) {
    for (const row of rows) {
      for (const name of piiColumns) if (row[name] !== null) row[name] = MASKED;
    }
  }

  return {
    dataset: dataset.id,
    columns: compiled.columns.map((c) => ({ name: c.name, type: c.type })),
    rows,
    limited: rows.length >= compiled.limit,
    elapsedMs,
  };
}

export interface SandboxElement {
  id: string;
  page: string;
  title: string;
  html: string;
  css: string;
  js: string;
  w: number;
  h: number;
  position: number;
  createdBy: string | null;
  updatedAt: string;
}

export interface SandboxElementInput {
  id?: string;
  page?: string;
  title?: string;
  html?: string;
  css?: string;
  js?: string;
  w?: number;
  h?: number;
  position?: number;
}

const ELEMENT_COLUMNS = sql`id::text, page, title, html, css, js, w, h, position, created_by::text as "createdBy", updated_at as "updatedAt"`;

function rowToElement(row: Record<string, unknown>): SandboxElement {
  return {
    id: String(row.id),
    page: String(row.page),
    title: String(row.title),
    html: String(row.html ?? ''),
    css: String(row.css ?? ''),
    js: String(row.js ?? ''),
    w: Number(row.w),
    h: Number(row.h),
    position: Number(row.position),
    createdBy: (row.createdBy as string | null) ?? null,
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
  };
}

function assertSize(input: SandboxElementInput): void {
  const bytes = (['html', 'css', 'js'] as const).reduce(
    (total, key) => total + Buffer.byteLength(input[key] ?? '', 'utf8'),
    0,
  );
  if (bytes > ELEMENT_MAX_BYTES) {
    throw new SandboxQueryError(
      `element code is ${bytes} bytes; the limit is ${ELEMENT_MAX_BYTES}`,
      'html',
    );
  }
}

function rows(result: unknown): Record<string, unknown>[] {
  return result as Record<string, unknown>[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `${id}::uuid` on a non-uuid is a Postgres 22P02 — a 500 for a caller
 *  mistake. Reject it as the 400 it is, before any SQL runs. */
function requireUuid(id: unknown, field: string): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new SandboxQueryError('invalid element id', field);
  }
  return id;
}

export function listElements(ctx: CoreCtx, page = 'default'): Promise<SandboxElement[]> {
  return withOrgCore(ctx, async (tx: CoreTx) => {
    const result = rows(
      await tx.execute(sql`
        select ${ELEMENT_COLUMNS} from sandbox_elements
        where org_id = ${ctx.tenantId} and page = ${page}
        order by position asc, id asc
      `),
    );
    return result.map(rowToElement);
  });
}

/**
 * Create (no `id`) or patch (with `id`) one element. The patch is a single
 * statement with `coalesce(<new>, <old>)` per field, so an omitted field keeps
 * its stored value and the row is never read-modify-written.
 */
export async function upsertElement(
  ctx: CoreCtx,
  input: SandboxElementInput,
): Promise<SandboxElement> {
  assertSize(input);
  const id = input.id === undefined ? null : requireUuid(input.id, 'id');
  const page = input.page ?? 'default';
  const result = await withOrgCore(ctx, async (tx: CoreTx) => {
    if (id) {
      return rows(
        await tx.execute(sql`
          update sandbox_elements set
            title = coalesce(${input.title ?? null}, title),
            html = coalesce(${input.html ?? null}, html),
            css = coalesce(${input.css ?? null}, css),
            js = coalesce(${input.js ?? null}, js),
            w = coalesce(${input.w ?? null}, w),
            h = coalesce(${input.h ?? null}, h),
            position = coalesce(${input.position ?? null}, position),
            updated_at = now()
          where org_id = ${ctx.tenantId} and id = ${id}::uuid
          returning ${ELEMENT_COLUMNS}
        `),
      );
    }
    if (!input.title) throw new SandboxQueryError('title is required', 'title');
    return rows(
      await tx.execute(sql`
        insert into sandbox_elements (org_id, page, title, html, css, js, w, h, position, created_by)
        values (
          ${ctx.tenantId}, ${page}, ${input.title},
          ${input.html ?? ''}, ${input.css ?? ''}, ${input.js ?? ''},
          ${input.w ?? 2}, ${input.h ?? 2},
          coalesce(
            ${input.position ?? null},
            (select coalesce(max(position), -1) + 1 from sandbox_elements
              where org_id = ${ctx.tenantId} and page = ${page})
          ),
          ${ctx.profileId ?? null}
        )
        returning ${ELEMENT_COLUMNS}
      `),
    );
  });
  const row = result[0];
  if (!row) throw new SandboxQueryError('element not found', 'id', 400);
  return rowToElement(row);
}

export async function removeElement(ctx: CoreCtx, id: string): Promise<boolean> {
  const elementId = requireUuid(id, 'id');
  const result = await withOrgCore(ctx, async (tx: CoreTx) =>
    rows(
      await tx.execute(
        sql`delete from sandbox_elements where org_id = ${ctx.tenantId} and id = ${elementId}::uuid returning id`,
      ),
    ),
  );
  return result.length > 0;
}
