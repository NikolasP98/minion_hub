#!/usr/bin/env bun
/**
 * FACES receivables and pending-work audit (minion-meta spec 128). READ ONLY: no apply flag, no writer.
 * Run as `bun --no-env-file scripts/faces-receivables-audit.ts --scope <scope.json> --out <dir> [--after D] [--before D]`.
 * Env (private, explicit): FACES_AUDIT_DATABASE_URL, FACES_OPERATOR_ACCESS_TOKEN, FACES_OPERATOR_ANON_KEY,
 * FACES_OPERATOR_AUTH_URL (the token is only sent to this URL; the scope file's authUrl must equal it).
 * Exit: 0 complete, 2 admission refused (no business read), 3 incomplete/error (incomplete.json, no manifest).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import type { WriteStream } from 'node:fs';
import type {
  AuditInterval,
  AuditScope,
  AuditSink,
  AuditSubject,
  QualifiedOperatorTarget,
  RepairProposal,
  ResidualRecord,
} from '../src/server/services/pos/accounts/audit.types';
import {
  assertInterval,
  intervalContained,
  isRealDate,
  sortProposals,
} from '../src/server/services/pos/accounts/audit.logic';
import * as evidenceModule from '../src/server/services/pos/accounts/audit.evidence';
import { operatorDatabaseIdentity, verifyOperatorPrincipal } from './lib/operator-principal';

export function readEvidenceFile(path: string): { json: unknown; bytes: string } {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size > 1_048_576
  ) {
    throw new CliAdmissionError('evidence_file_not_private_regular');
  }
  const bytes = readFileSync(path, 'utf8');
  try {
    return { json: JSON.parse(bytes), bytes };
  } catch {
    throw new CliAdmissionError('evidence_unreadable');
  }
}

function gitSha(): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

export class CliAdmissionError extends Error {
  constructor(readonly code: string) {
    super(`admission refused: ${code}`);
  }
}

export interface ApprovedScopeFile {
  orgId: string;
  actorProfileId: string;
  accountingTimezone: string;
  approved: AuditInterval;
  outputDirectory: string;
  target: QualifiedOperatorTarget;
  approvalRef?: string;
  evidence?: { path: string; sha256: string; approvedAssertionIds: string[] } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLAGS = new Set(['--scope', '--out', '--after', '--before']);

/** Strict flag parsing: unknown flags, repeats and missing values are refused. */
export function parseArgs(argv: readonly string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!FLAGS.has(flag) || value === undefined || value.startsWith('--') || flag in out) {
      throw new CliAdmissionError('invalid_arguments');
    }
    out[flag] = value;
  }
  if (!out['--scope'] || !out['--out']) throw new CliAdmissionError('invalid_arguments');
  for (const f of ['--after', '--before']) {
    if (f in out && !isRealDate(out[f])) throw new CliAdmissionError('invalid_date');
  }
  return {
    scopePath: out['--scope'],
    out: out['--out'],
    cohort: { after: out['--after'] ?? null, before: out['--before'] ?? null } as AuditInterval,
  };
}

function regularFile(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new CliAdmissionError('scope_not_regular_file');
  return readFileSync(path, 'utf8');
}

export function readScopeFile(path: string): ApprovedScopeFile {
  let raw: unknown;
  try {
    raw = JSON.parse(regularFile(path));
  } catch (error) {
    if (error instanceof CliAdmissionError) throw error;
    throw new CliAdmissionError('scope_unreadable');
  }
  const s = raw as Partial<ApprovedScopeFile> | null;
  if (
    !s ||
    typeof s.orgId !== 'string' ||
    !UUID.test(s.orgId) ||
    typeof s.actorProfileId !== 'string' ||
    !UUID.test(s.actorProfileId) ||
    typeof s.accountingTimezone !== 'string' ||
    !s.accountingTimezone ||
    typeof s.outputDirectory !== 'string' ||
    !s.approved ||
    !s.target?.databaseIdentity ||
    !s.target.authProject ||
    !s.target.authUrl
  ) {
    throw new CliAdmissionError('scope_invalid');
  }
  try {
    assertInterval(s.approved, 'approved scope');
  } catch {
    throw new CliAdmissionError('scope_invalid_interval');
  }
  return s as ApprovedScopeFile;
}

/** Cohort flags inherit the approved bounds; widening is refused, never clamped. */
export function resolveCohort(approved: AuditInterval, flags: AuditInterval): AuditInterval {
  const cohort = { after: flags.after ?? approved.after, before: flags.before ?? approved.before };
  try {
    assertInterval(cohort, 'cohort');
  } catch {
    throw new CliAdmissionError('cohort_invalid');
  }
  if (!intervalContained(cohort, approved))
    throw new CliAdmissionError('cohort_outside_approved_scope');
  return cohort;
}

/** --out must be the approved existing directory (realpath-equal); staging is created only after admission. */
export function admitOutputDirectory(out: string, approvedDir: string): string {
  try {
    const a = realpathSync(out);
    const b = realpathSync(approvedDir);
    if (a !== b || !lstatSync(a).isDirectory()) throw new Error('mismatch');
    return a;
  } catch {
    throw new CliAdmissionError('output_directory_not_approved');
  }
}

class JsonlWriter {
  private stream: WriteStream;
  private hash = createHash('sha256');
  rows = 0;
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  }
  async write(value: unknown): Promise<void> {
    const line = `${canonicalJson(value)}\n`;
    this.hash.update(line);
    this.rows += 1;
    if (!this.stream.write(line)) await once(this.stream, 'drain');
  }
  async end(): Promise<string> {
    this.stream.end();
    await once(this.stream, 'finish');
    return this.hash.digest('hex');
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Atomic private publication: <out>/<runId>.staging/ renamed to <out>/<runId>/, manifest written last. */
export class RunOutput implements AuditSink {
  readonly staging: string;
  readonly final: string;
  private subjects: JsonlWriter;
  private residuals: JsonlWriter;
  constructor(
    outDir: string,
    readonly runId: string,
  ) {
    this.staging = join(outDir, `${runId}.staging`);
    this.final = join(outDir, runId);
    if (existsSync(this.staging) || existsSync(this.final))
      throw new CliAdmissionError('run_already_exists');
    mkdirSync(this.staging, { mode: 0o700 });
    this.subjects = new JsonlWriter(join(this.staging, 'subjects.jsonl'));
    this.residuals = new JsonlWriter(join(this.staging, 'residuals.jsonl'));
  }
  writeSubject(subject: AuditSubject) {
    return this.subjects.write(subject);
  }
  writeResidual(residual: ResidualRecord) {
    return this.residuals.write(residual);
  }
  /** Writes protected repair-proposals.json (inert envelopes, always pending_owner_approval; no apply mode exists). */
  async publish(summary: unknown, proposals: readonly RepairProposal[] = []): Promise<void> {
    const subjectsSha256 = await this.subjects.end();
    const residualsSha256 = await this.residuals.end();
    writeFileSync(join(this.staging, 'summary.json'), `${canonicalJson(summary)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    const proposalsText = `${canonicalJson(sortProposals(proposals))}\n`;
    writeFileSync(join(this.staging, 'repair-proposals.json'), proposalsText, {
      mode: 0o600,
      flag: 'wx',
    });
    const manifest = {
      proposals: {
        count: proposals.length,
        sha256: createHash('sha256').update(proposalsText).digest('hex'),
      },
      schemaVersion: 1,
      runId: this.runId,
      subjects: { rows: this.subjects.rows, sha256: subjectsSha256 },
      residuals: { rows: this.residuals.rows, sha256: residualsSha256 },
    };
    writeFileSync(join(this.staging, 'manifest.json'), `${canonicalJson(manifest)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(this.staging, this.final);
  }
  /** Handled failure: labelled incomplete staging, never a manifest. */
  async fail(code: string): Promise<void> {
    await Promise.allSettled([this.subjects.end(), this.residuals.end()]);
    writeFileSync(
      join(this.staging, 'incomplete.json'),
      `${canonicalJson({ schemaVersion: 1, runId: this.runId, code })}\n`,
      {
        mode: 0o600,
        flag: 'wx',
      },
    );
  }
}

async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let output: RunOutput | undefined;
  try {
    const args = parseArgs(argv);
    const scopeFile = readScopeFile(args.scopePath);
    const cohort = resolveCohort(scopeFile.approved, args.cohort);
    const outDir = admitOutputDirectory(args.out, scopeFile.outputDirectory);
    const url = env.FACES_AUDIT_DATABASE_URL;
    const token = env.FACES_OPERATOR_ACCESS_TOKEN;
    const anonKey = env.FACES_OPERATOR_ANON_KEY;
    if (!url || !token || !anonKey) throw new CliAdmissionError('missing_private_input');
    if (
      operatorDatabaseIdentity(url, scopeFile.target.authProject) !==
      scopeFile.target.databaseIdentity
    ) {
      throw new CliAdmissionError('database_identity_mismatch');
    }
    const principal = await verifyOperatorPrincipal({
      accessToken: token,
      authUrl: scopeFile.target.authUrl,
      trustedAuthUrl: env.FACES_OPERATOR_AUTH_URL,
      anonKey,
      expectedProfileId: scopeFile.actorProfileId,
      targetFingerprint: scopeFile.target,
    });
    // Only now may the application service graph load.
    const { createOperatorServiceLoader } = await import('./lib/operator-service-loader');
    const loader = await createOperatorServiceLoader({ principal, target: scopeFile.target });
    const postgresModule = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { sql } = await import('drizzle-orm');
    let client: ReturnType<typeof postgresModule.default> | undefined;
    try {
      const [audit, orgCore, pgPool, rbac, perms] = await Promise.all([
        loader.load('audit'),
        loader.load('orgCore'),
        loader.load('pgPool'),
        loader.load('rbac'),
        import('../src/lib/permissions'),
      ]);
      const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
      client = postgresModule.default(url, {
        max: 1,
        prepare: false,
        fetch_types: false,
        types: pgPool.ARRAY_TYPES as unknown as Record<string, import('postgres').PostgresType>,
        ssl: remote ? { rejectUnauthorized: true, servername: new URL(url).hostname } : false,
        connection: { statement_timeout: 120_000, application_name: 'faces-receivables-audit' },
      });
      const db = drizzle(client);
      const scope: AuditScope = {
        orgId: scopeFile.orgId,
        accountingTimezone: scopeFile.accountingTimezone,
        approved: scopeFile.approved,
        cohort,
      };
      type Tx = Parameters<typeof orgCore.applyOrgTxScope>[0];
      const cohortIds = new Set<string>();
      const bookingStatus = new Map<string, string>();
      const lineIds = new Set<string>();
      let proposals: RepairProposal[] = [];
      const summary = await db.transaction(
        async (rawTx) => {
          const tx = rawTx as unknown as Tx;
          await orgCore.applyOrgTxScope(tx, scope.orgId, principal.profileId);
          const [identity] = await tx.execute<{ db: string; ro: string }>(
            sql`select current_database() as db, current_setting('transaction_read_only') as ro`,
          );
          if (
            identity?.db !== decodeURIComponent(new URL(url).pathname.slice(1)) ||
            identity.ro !== 'on'
          ) {
            throw new CliAdmissionError('connection_identity_mismatch');
          }
          const caps = await rbac.resolveFreshCapabilitiesReadOnlyInTransaction(
            tx,
            scope.orgId,
            principal.profileId,
          );
          const c = caps.capabilities;
          const ok =
            c.can('pos', 'view') &&
            c.can('pos', 'export') &&
            c.can('finance', 'view') &&
            c.can('finance', 'export') &&
            !c.ownerScoped('pos') &&
            !c.ownerScoped('finance') &&
            c.fieldLevel('finance') >= perms.SENSITIVE_FIELD_LEVEL;
          if (!ok) throw new CliAdmissionError('insufficient_authority');
          // Evidence-bearing runs need the ACTUAL owner membership, checked before any subject inventory.
          if (scopeFile.evidence && caps.membershipRole !== 'owner') {
            throw new CliAdmissionError('owner_required_for_evidence');
          }
          const modules = await tx.execute<{ module_id: string; enabled: boolean }>(
            sql`select module_id, enabled from public.app_modules where org_id = ${scope.orgId} and module_id in ('pos','finances','stock')`,
          );
          if (modules.some((m) => m.enabled === false && m.module_id !== 'stock'))
            throw new CliAdmissionError('required_module_disabled');
          const stockAllowed =
            !modules.some((m) => m.module_id === 'stock' && m.enabled === false) &&
            c.can('stock', 'view') &&
            !c.ownerScoped('stock');
          // Staging exists only after admission, so an exit-2 refusal never leaves a directory.
          const out = new RunOutput(outDir, randomUUID());
          output = out;
          const recording: AuditSink = {
            async writeSubject(subject) {
              if (subject.inCohort) cohortIds.add(subject.id);
              if (subject.kind === 'booking') bookingStatus.set(subject.id, subject.status);
              else lineIds.add(subject.id);
              await out.writeSubject(subject);
            },
            writeResidual: (r) => out.writeResidual(r),
          };
          const result = await audit.runAuditInventory(tx as never, scope, recording);
          if (scopeFile.evidence) {
            const evidence = readEvidenceFile(scopeFile.evidence.path);
            const admitted = evidenceModule.admitEvidence(
              evidence.json,
              evidence.bytes,
              scopeFile.evidence,
              {
                orgId: scope.orgId,
                approvalRef: scopeFile.approvalRef ?? '',
                actorProfileId: principal.profileId,
                membershipRole: caps.membershipRole,
                runStart: new Date().toISOString(),
                bookingStatus: (id) => bookingStatus.get(id) ?? null,
                lineKnown: (id) => lineIds.has(id),
              },
            );
            const pass = await audit.runAuditProposals(tx as never, {
              scope,
              admitted,
              cohortIds,
              stockAllowed,
              sourceGitSha: gitSha(),
              run: { runId: out.runId, observedAt: new Date().toISOString() },
            });
            proposals = pass.proposals;
          }
          return result;
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      await output!.publish(summary, proposals);
      console.log(JSON.stringify({ run: output!.final, totals: summary.totals }));
      return 0;
    } finally {
      await client?.end({ timeout: 5 });
      await loader.close();
    }
  } catch (error) {
    if (
      error instanceof CliAdmissionError ||
      (error as { name?: string })?.name === 'AuditAdmissionError' ||
      (error as { name?: string })?.name === 'OperatorPrincipalError' ||
      (error as { name?: string })?.name === 'OperatorAuthorityError'
    ) {
      await output?.fail('admission_refused').catch(() => undefined);
      console.error(`refused: ${(error as { code?: string }).code ?? (error as Error).message}`);
      return 2;
    }
    await output?.fail('incomplete').catch(() => undefined);
    console.error('audit incomplete: see incomplete.json; no manifest was published');
    return 3;
  }
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), process.env));
