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

/**
 * One environment's recorded audit run, transcribed from a real
 * `bun run audit:server-tenant-scope` output by the credential holder.
 */
export interface RecordedAuditRun {
  environment: string;
  recordedAt: string;
  recordedBy: string;
  command: string;
  tursoServerRows: number;
  nullTenantIds: number;
  unmatchedTenantIds: number;
}

/** The re-key deployment this branch's parked predicate change waits on. */
export interface RecordedRekeyRecord {
  identifier: string;
  appliedAt: string;
  applyEvidence: string;
  rollbackNote: string;
}

export interface RekeyReadinessEvidence {
  schemaVersion: number;
  runs: RecordedAuditRun[];
  rekeyRecord: RecordedRekeyRecord;
}

/** Environments the spec requires an audit run for, in the order it names them. */
export const REQUIRED_AUDIT_ENVIRONMENTS = ['non-production', 'production'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function runFailures(environment: string, run: unknown): string[] {
  if (run === undefined) {
    return [`no recorded audit run for the ${environment} environment`];
  }
  if (typeof run !== 'object' || run === null) {
    return [`${environment} audit run is not an object`];
  }
  const r = run as Record<string, unknown>;
  const failures: string[] = [];
  for (const field of ['recordedAt', 'recordedBy', 'command'] as const) {
    if (!isNonEmptyString(r[field])) failures.push(`${environment} audit run is missing ${field}`);
  }
  if (typeof r.tursoServerRows !== 'number' || r.tursoServerRows <= 0) {
    failures.push(
      `${environment} audit run must record a non-zero turso_server_rows (it proves nothing otherwise)`,
    );
  }
  for (const [field, counter] of [
    ['null_tenant_ids', r.nullTenantIds],
    ['unmatched_tenant_ids', r.unmatchedTenantIds],
  ] as const) {
    if (counter !== 0)
      failures.push(`${environment} audit run must record ${field}=0, got ${String(counter)}`);
  }
  return failures;
}

/**
 * Executable form of the spec's Slice 1 stop rule.
 *
 * The tenant predicate may only exist in `updateServer` once a credential holder
 * has recorded a passing audit for both environments plus the concrete re-key
 * record. While the predicate is absent the gate passes with no evidence: the
 * parked state is the correct state, and demanding evidence for it would just
 * red the suite for work nobody has done yet.
 *
 * `predicateIsTenantScoped` comes from reading the shipped service source, so
 * this cannot be satisfied by editing the evidence file alone, nor bypassed by
 * editing the service alone.
 */
export function rekeyReadinessGateFailures(input: {
  predicateIsTenantScoped: boolean;
  evidence: unknown;
}): string[] {
  if (!input.predicateIsTenantScoped) return [];

  if (input.evidence === undefined) {
    return [
      'updateServer is tenant-scoped but no re-key readiness evidence is recorded — see docs/runbooks/server-tenant-scope-rekey-readiness.md',
    ];
  }
  if (typeof input.evidence !== 'object' || input.evidence === null) {
    return ['re-key readiness evidence is not an object'];
  }

  const evidence = input.evidence as Record<string, unknown>;
  const failures: string[] = [];

  const runs = Array.isArray(evidence.runs) ? (evidence.runs as unknown[]) : [];
  if (!Array.isArray(evidence.runs)) failures.push('re-key readiness evidence has no `runs` array');
  for (const environment of REQUIRED_AUDIT_ENVIRONMENTS) {
    const run = runs.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as Record<string, unknown>).environment === environment,
    );
    failures.push(...runFailures(environment, run));
  }

  const record = evidence.rekeyRecord;
  if (typeof record !== 'object' || record === null) {
    failures.push('re-key readiness evidence has no `rekeyRecord`');
  } else {
    const r = record as Record<string, unknown>;
    for (const field of ['identifier', 'appliedAt', 'applyEvidence', 'rollbackNote'] as const) {
      if (!isNonEmptyString(r[field])) failures.push(`rekeyRecord is missing ${field}`);
    }
  }

  return failures;
}

/**
 * Whether `updateServer`'s body constrains the mutation by tenant.
 *
 * Reads the shipped service source rather than a copy: the gate must track the
 * file that actually runs in production. Scoped to `updateServer` alone, since
 * sibling services in the same file legitimately reference `servers.tenantId`.
 */
export function updateServerIsTenantScoped(serviceSource: string): boolean {
  const start = serviceSource.indexOf('export async function updateServer(');
  if (start === -1) {
    throw new Error(
      'updateServer was not found in server.service.ts — the re-key readiness gate is anchored to a symbol that moved',
    );
  }
  const nextExport = serviceSource.indexOf('\nexport ', start + 1);
  const body = serviceSource.slice(start, nextExport === -1 ? undefined : nextExport);
  return /servers\.tenantId/.test(body);
}
