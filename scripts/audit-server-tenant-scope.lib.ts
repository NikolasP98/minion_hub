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
 * Executable form of the spec's Slice 1 stop rule, in both directions.
 *
 * The rule the spec writes down is one-way — no tenant predicate in
 * `updateServer` until a credential holder has recorded a passing audit for both
 * environments plus the concrete re-key record — and the gate enforces it: a
 * scoped mutation with incomplete evidence fails, naming every missing artifact.
 *
 * The converse matters just as much and is easier to miss. Once the evidence is
 * complete, a one-way gate goes permanently quiet: it would report "fine" for a
 * `updateServer` that still matches on `servers.id` alone, i.e. for exactly the
 * cross-tenant write the evidence was gathered to let us close. So complete
 * evidence plus an unscoped mutation is also a failure — the gate then says
 * Slice 2 is owed, rather than saying nothing.
 *
 * Neither half can be satisfied by editing one file: `predicateIsTenantScoped`
 * describes the shipped mutation (observed behaviour first, source shape as
 * defence in depth), and `evidence` is what a human recorded.
 */
export function rekeyReadinessGateFailures(input: {
  predicateIsTenantScoped: boolean;
  evidence: unknown;
}): string[] {
  const owed = evidenceFailures(input.evidence);
  if (input.predicateIsTenantScoped) return owed;
  if (owed.length === 0) {
    return [
      'the recorded re-key readiness evidence is complete, but the shipped updateServer still ' +
        'mutates by servers.id alone — Slice 2 owes it eq(servers.tenantId, ctx.tenantId); see ' +
        'docs/runbooks/server-tenant-scope-rekey-readiness.md',
    ];
  }
  // Parked: no predicate, no complete evidence. That is the correct state and
  // demanding evidence for work nobody has started would just red the suite.
  return [];
}

/**
 * Everything the recorded evidence still owes, artifact by artifact.
 *
 * An absent file enumerates the same per-artifact list as an empty one (after
 * the pointer line): "no evidence" is the state this branch is actually in, and
 * a single summary line there would make the one report an operator reads the
 * least specific one.
 */
function evidenceFailures(evidence: unknown): string[] {
  if (evidence === undefined) {
    return [
      `no re-key readiness evidence is recorded at ${EVIDENCE_RELATIVE_PATH} — see docs/runbooks/server-tenant-scope-rekey-readiness.md`,
      ...evidenceFailures({}),
    ];
  }
  if (typeof evidence !== 'object' || evidence === null) {
    return ['re-key readiness evidence is not an object'];
  }

  const evidenceObject = evidence as Record<string, unknown>;
  const failures: string[] = [];

  const runs = Array.isArray(evidenceObject.runs) ? (evidenceObject.runs as unknown[]) : [];
  if (!Array.isArray(evidenceObject.runs)) {
    failures.push('re-key readiness evidence has no `runs` array');
  }
  for (const environment of REQUIRED_AUDIT_ENVIRONMENTS) {
    const run = runs.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as Record<string, unknown>).environment === environment,
    );
    failures.push(...runFailures(environment, run));
  }

  const record = evidenceObject.rekeyRecord;
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

/** `servers.tenantId`, tolerating the whitespace a formatter may introduce. */
const TENANT_COLUMN_REFERENCE = /\bservers\s*\.\s*tenantId\b/;

/**
 * Blank out comment bodies and string/template contents so a source scan sees
 * code only.
 *
 * The gate's whole job is to answer "does the shipped mutation filter by
 * tenant?", and prose is the cheapest way to fake a yes: a `// TODO: add
 * eq(servers.tenantId, …)` comment reads identically to the predicate itself
 * under a plain text search. Quotes are kept (as an empty pair) so what is left
 * still has the same expression shape.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      i++;
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      // A template literal's `${…}` interpolations go with it. Dropping code is
      // fail-closed here: it can only remove a tenant reference, never add one.
      out += char + char;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

/** Index of the `)`/`}` closing the bracket at `open`, or -1 if unbalanced. */
function matchingBracket(source: string, open: number, openChar: '(' | '{'): number {
  const closeChar = openChar === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `updateServer`'s body, braces included, from comment/string-stripped source. */
function updateServerBody(strippedSource: string): string {
  const start = strippedSource.indexOf('export async function updateServer(');
  if (start === -1) {
    throw new Error(
      'updateServer was not found in server.service.ts — the re-key readiness gate is anchored to a symbol that moved',
    );
  }
  const paramsOpen = strippedSource.indexOf('(', start);
  const paramsClose = matchingBracket(strippedSource, paramsOpen, '(');
  // The signature carries no object-typed return annotation today, so the first
  // `{` after the parameter list opens the body. If that ever changes, the brace
  // balancing below throws rather than answering from a partial body.
  const bodyOpen = paramsClose === -1 ? -1 : strippedSource.indexOf('{', paramsClose);
  const bodyClose = bodyOpen === -1 ? -1 : matchingBracket(strippedSource, bodyOpen, '{');
  if (bodyClose === -1) {
    throw new Error(
      'updateServer’s body could not be delimited — the re-key readiness gate is anchored to a shape that moved',
    );
  }
  return strippedSource.slice(bodyOpen, bodyClose + 1);
}

/**
 * The `.where(…)` argument of every `update(servers)` chain in `body`, in source
 * order. `null` means that chain ends with no `.where(…)` attached — an
 * unfiltered mutation, which is the least tenant-scoped shape there is.
 *
 * Walking the chain (rather than scanning the statement) is what makes the gate
 * answer about the predicate: `.set(…)`, a preceding `.select(…).where(…)` read
 * and any argument-nested call are stepped over by bracket balancing, so what
 * comes back is only the expression the database filters the UPDATE on.
 */
function updateWhereArguments(body: string): Array<string | null> {
  const whereArguments: Array<string | null> = [];
  const updateCall = /\.update\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = updateCall.exec(body)) !== null) {
    const argsOpen = match.index + match[0].length - 1;
    const argsClose = matchingBracket(body, argsOpen, '(');
    if (argsClose === -1) break;
    // `.update(someOtherTable)` in the same body is not this gate's business.
    if (body.slice(argsOpen + 1, argsClose).trim() !== 'servers') continue;

    let cursor = argsClose + 1;
    let whereArgument: string | null = null;
    for (;;) {
      const step = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(body.slice(cursor));
      if (!step) break;
      const stepOpen = cursor + step[0].length - 1;
      const stepClose = matchingBracket(body, stepOpen, '(');
      if (stepClose === -1) break;
      if (step[1] === 'where') whereArgument = body.slice(stepOpen + 1, stepClose);
      cursor = stepClose + 1;
    }

    whereArguments.push(whereArgument);
    updateCall.lastIndex = cursor;
  }

  return whereArguments;
}

/**
 * Whether the UPDATE `updateServer` issues is filtered by tenant.
 *
 * Reads the shipped service source rather than a copy: the gate must track the
 * file that actually runs in production. It answers about the mutation's
 * `.where(…)` expression specifically — not about the text of the function —
 * because everything else in scope can mention `servers.tenantId` without
 * constraining a single row: a comment, a `console.log`, an assignment into the
 * `set` object, a preceding tenant-scoped *read*. Under a whole-body text
 * search every one of those reads as "scoped", which would let the gate certify
 * a mutation that still matches on `servers.id` alone.
 *
 * Fail-closed on every ambiguity: a chain with no `.where(…)` is unscoped, and
 * if several `update(servers)` chains exist they must *all* be tenant-filtered.
 * A missing symbol, or an `update(servers)` that has disappeared, throws — so a
 * refactor that moves the mutation cannot quietly answer "scoped".
 *
 * This is defence in depth over the source. The gate's primary input is the
 * *observed* behaviour of the shipped `updateServer` — see
 * `src/server/services/server.service.test.ts`, "updateServer tenant scope".
 */
export function updateServerIsTenantScoped(serviceSource: string): boolean {
  const body = updateServerBody(stripCommentsAndStrings(serviceSource));
  const whereArguments = updateWhereArguments(body);
  if (whereArguments.length === 0) {
    throw new Error(
      'updateServer no longer issues an update(servers) — the re-key readiness gate is anchored to a shape that moved',
    );
  }
  return whereArguments.every(
    (argument) => argument !== null && TENANT_COLUMN_REFERENCE.test(argument),
  );
}

/** Where a credential holder's recorded evidence lives, relative to the repo root. */
export const EVIDENCE_RELATIVE_PATH = 'tests/rekey-readiness/evidence.json';

/** An empty `rekeyRecord` shape, so a partially-recorded file still shows what is owed. */
function blankRekeyRecord(): RecordedRekeyRecord {
  return { identifier: '', appliedAt: '', applyEvidence: '', rollbackNote: '' };
}

function asRekeyRecord(value: unknown): RecordedRekeyRecord {
  if (typeof value !== 'object' || value === null) return blankRekeyRecord();
  const r = value as Record<string, unknown>;
  const blank = blankRekeyRecord();
  return {
    identifier: isNonEmptyString(r.identifier) ? r.identifier : blank.identifier,
    appliedAt: isNonEmptyString(r.appliedAt) ? r.appliedAt : blank.appliedAt,
    applyEvidence: isNonEmptyString(r.applyEvidence) ? r.applyEvidence : blank.applyEvidence,
    rollbackNote: isNonEmptyString(r.rollbackNote) ? r.rollbackNote : blank.rollbackNote,
  };
}

/**
 * Merge one real audit run into the recorded evidence file.
 *
 * Hand-transcribing `turso_server_rows=… null_tenant_ids=… unmatched_tenant_ids=…`
 * into JSON is the one step of the Slice 1 gate where a typo silently changes the
 * answer, so `--record` writes the counters the run actually produced. The
 * function refuses anything the gate would later reject — an unknown environment
 * name, a zero-row run, a non-zero mismatch counter — because a rejected run must
 * never reach the file at all: an operator who sees a written file reasonably
 * reads it as "this environment is done".
 *
 * Anything already recorded for the *other* environment, and any `rekeyRecord`
 * fields a human has filled in, are preserved.
 */
export function recordAuditRun(existing: unknown, run: RecordedAuditRun): RekeyReadinessEvidence {
  if (!(REQUIRED_AUDIT_ENVIRONMENTS as readonly string[]).includes(run.environment)) {
    throw new Error(
      `unknown environment "${run.environment}" — the spec requires exactly ${REQUIRED_AUDIT_ENVIRONMENTS.join(' and ')}`,
    );
  }
  const failures = runFailures(run.environment, run);
  if (failures.length > 0) {
    throw new Error(
      `refusing to record an audit run that the gate rejects: ${failures.join('; ')}`,
    );
  }
  if (existing !== undefined && (typeof existing !== 'object' || existing === null)) {
    throw new Error(
      `${EVIDENCE_RELATIVE_PATH} exists but is not a JSON object — refusing to overwrite it`,
    );
  }

  const previous = (existing ?? {}) as Record<string, unknown>;
  const previousRuns = Array.isArray(previous.runs) ? (previous.runs as unknown[]) : [];
  const kept = previousRuns.filter(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Record<string, unknown>).environment !== run.environment,
  ) as RecordedAuditRun[];

  const runs = [...kept, run].sort(
    (a, b) =>
      REQUIRED_AUDIT_ENVIRONMENTS.indexOf(
        a.environment as (typeof REQUIRED_AUDIT_ENVIRONMENTS)[number],
      ) -
      REQUIRED_AUDIT_ENVIRONMENTS.indexOf(
        b.environment as (typeof REQUIRED_AUDIT_ENVIRONMENTS)[number],
      ),
  );

  return { schemaVersion: 1, runs, rekeyRecord: asRekeyRecord(previous.rekeyRecord) };
}

export interface RekeyReadinessReport {
  status: 'READY' | 'BLOCKED';
  /** Everything the spec still owes, in the order the runbook lists it. Empty when READY. */
  missing: string[];
}

/**
 * Ask the readiness question unconditionally — "is the recorded evidence
 * complete?" — rather than the gate's conditional "may the shipped predicate
 * exist?".
 *
 * The gate is deliberately quiet while the predicate is parked (there is nothing
 * to stop), which means a green test suite says nothing about whether Slice 1's
 * human half is done. This is the other half: `bun run rekey:readiness` answers
 * BLOCKED, with the missing artifacts named, until a credential holder has
 * recorded both runs and the re-key record. It shares the gate's rules rather
 * than restating them, so the two answers can never drift apart.
 */
export function rekeyReadinessReport(evidence: unknown): RekeyReadinessReport {
  const missing = rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence });
  return { status: missing.length === 0 ? 'READY' : 'BLOCKED', missing };
}

/** Machine-greppable first line, mirroring the audit's counters line. */
export function formatReadinessReport(report: RekeyReadinessReport): string {
  return `rekey_readiness=${report.status} missing=${report.missing.length}`;
}

export interface RekeyCliOptions {
  /** Environment to record this run under; null when the run is read-only. */
  recordEnvironment: string | null;
  /** Overrides the default evidence path. Tests use it; operators normally don't. */
  evidencePath: string | null;
}

/**
 * Parse the two commands' flags.
 *
 * Kept here (and covered by fixtures) because a mistyped `--record prod` must
 * abort rather than silently record nothing, or record under a name the gate
 * will not look for.
 */
export function parseRekeyCliArgs(
  argv: readonly string[],
  options: { allowRecord: boolean },
): RekeyCliOptions {
  let recordEnvironment: string | null = null;
  let evidencePath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--record' && options.allowRecord) {
      const value = argv[++i];
      if (!isNonEmptyString(value)) {
        throw new Error(
          `--record needs an environment: ${REQUIRED_AUDIT_ENVIRONMENTS.join(' | ')}`,
        );
      }
      if (!(REQUIRED_AUDIT_ENVIRONMENTS as readonly string[]).includes(value)) {
        throw new Error(
          `--record ${value} is not one of the environments the spec requires: ${REQUIRED_AUDIT_ENVIRONMENTS.join(' | ')}`,
        );
      }
      recordEnvironment = value;
      continue;
    }
    if (arg === '--evidence') {
      const value = argv[++i];
      if (!isNonEmptyString(value)) throw new Error('--evidence needs a file path');
      evidencePath = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { recordEnvironment, evidencePath };
}
