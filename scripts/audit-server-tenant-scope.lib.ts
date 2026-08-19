/**
 * Pure comparison core of the read-only two-source re-key readiness audit
 * (specs/2026-08-18-hub-updateserver-tenant-scope-spec.md Slice 1).
 *
 * Kept free of database I/O so the comparison rules — the part that decides
 * whether Slice 2 may proceed — are exercised by fixtures in
 * `scripts/audit-server-tenant-scope.test.ts` instead of only ever running for
 * the first time against a production database. The CLI in
 * `scripts/audit-server-tenant-scope.ts` supplies the two real sources.
 */

export interface TursoServerRow {
  id: string;
  tenantId: string | null;
}

export interface TenantScopeAuditResult {
  tursoServerRows: number;
  nullTenantIds: number;
  unmatchedTenantIds: number;
  /** Up to 10 `servers.id` values whose tenant id is absent from the canonical set. */
  unmatchedSample: string[];
  pass: boolean;
  /** Human-readable reasons the audit did not prove readiness. Empty when `pass`. */
  failReasons: string[];
}

const UNMATCHED_SAMPLE_LIMIT = 10;

/**
 * Compare Turso `servers.tenant_id` values against the canonical Supabase
 * `organizations.id` set by exact string equality (the databases are physically
 * separate and cannot be joined in SQL).
 *
 * Fails closed: an empty server set or an empty organization set proves nothing
 * about production and must not be reported as readiness.
 */
export function auditTenantScope(input: {
  serverRows: readonly TursoServerRow[];
  orgIds: ReadonlySet<string>;
}): TenantScopeAuditResult {
  const { serverRows, orgIds } = input;

  let nullTenantIds = 0;
  let unmatchedTenantIds = 0;
  const unmatchedSample: string[] = [];

  for (const row of serverRows) {
    if (row.tenantId == null || row.tenantId === '') {
      nullTenantIds++;
      continue;
    }
    // Several servers sharing one tenant id is normal and is not an error here;
    // this only flags tenant ids missing from the canonical organization set.
    if (!orgIds.has(row.tenantId)) {
      unmatchedTenantIds++;
      if (unmatchedSample.length < UNMATCHED_SAMPLE_LIMIT) unmatchedSample.push(row.id);
    }
  }

  const failReasons: string[] = [];
  if (serverRows.length === 0) {
    failReasons.push(
      'inspected 0 Turso servers rows — the audit connected to an empty or wrong database and proves nothing',
    );
  }
  if (orgIds.size === 0) {
    failReasons.push(
      'read 0 canonical Supabase organizations — the audit connected to an empty or wrong project and proves nothing',
    );
  }
  if (nullTenantIds > 0)
    failReasons.push(`${nullTenantIds} servers row(s) have a null/empty tenant_id`);
  if (unmatchedTenantIds > 0) {
    failReasons.push(
      `${unmatchedTenantIds} servers row(s) carry a tenant_id absent from canonical organizations.id`,
    );
  }

  return {
    tursoServerRows: serverRows.length,
    nullTenantIds,
    unmatchedTenantIds,
    unmatchedSample,
    pass: failReasons.length === 0,
    failReasons,
  };
}

/** The machine-readable line the spec's Definition of done greps for. */
export function formatAuditCounters(result: TenantScopeAuditResult): string {
  return `turso_server_rows=${result.tursoServerRows} null_tenant_ids=${result.nullTenantIds} unmatched_tenant_ids=${result.unmatchedTenantIds}`;
}

/**
 * Drain a paginated canonical-organization read into an exact-match set.
 *
 * Split out from the CLI so the page-boundary behaviour (a final page that is
 * exactly `pageSize` long must still trigger one more request) is covered by
 * fixtures rather than only ever exercised against a real project.
 *
 * `fetchPage` must apply a stable sort: an unordered range scan may repeat or
 * skip rows across pages, and a skipped organization id would surface as a
 * false `unmatched_tenant_ids` hit.
 */
export async function collectCanonicalOrgIds(
  fetchPage: (offset: number, limit: number) => Promise<string[]>,
  pageSize = 1000,
): Promise<Set<string>> {
  const orgIds = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    if (page.length === 0) break;
    for (const id of page) orgIds.add(id);
    if (page.length < pageSize) break;
  }
  return orgIds;
}
