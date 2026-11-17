#!/usr/bin/env bun
/**
 * FACES stock reconciliation diagnostic (minion-meta spec 122, contracts/report.md). READ-ONLY: no apply flag, no writer,
 * no repair service call. Required: --org <uuid> --case-manifest <private-json> --output <private-json>.
 * Private env: FACES_STOCK_DATABASE_URL, FACES_OPERATOR_ACCESS_TOKEN, FACES_OPERATOR_ANON_KEY, FACES_OPERATOR_AUTH_URL (the only auth URL that may receive the token; a manifest authUrl must equal it) (never printed, never flags).
 * Exit 0 complete (unresolved cases are findings), 2 refusal before data access, 3 incomplete, 4 integrity failure.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { operatorDatabaseIdentity, verifyOperatorPrincipal } from './lib/operator-principal';
import {
  ReconciliationError,
  UUID_RE,
  canonicalJson,
  decodeDiagnosticManifestV1,
  type DiagnosticManifestV1,
} from './lib/faces-stock-reconciliation';

export class CliAdmissionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CliAdmissionError';
  }
}

const OUTPUT_MAX_BYTES = 20_971_520;
const TOTAL_MS = 60_000;

export interface Args {
  org: string;
  manifestPath: string;
  outputPath: string;
}

/** Exact flag set; anything missing, duplicated, unknown or valueless refuses before any import or read. */
export function parseArgs(argv: readonly string[]): Args {
  const seen = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !['--org', '--case-manifest', '--output'].includes(flag) ||
      value === undefined ||
      value.startsWith('--') ||
      seen.has(flag)
    )
      throw new CliAdmissionError('invalid_arguments');
    seen.set(flag, value);
  }
  const org = seen.get('--org');
  const manifestPath = seen.get('--case-manifest');
  const outputPath = seen.get('--output');
  if (!org || !UUID_RE.test(org) || !manifestPath || !outputPath)
    throw new CliAdmissionError('invalid_arguments');
  return { org, manifestPath, outputPath };
}

/** Input files are private: a regular file with no group/other bits. */
export function readPrivateJson(path: string): unknown {
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new CliAdmissionError('manifest_unreadable');
  }
  if (!st.isFile() || (st.mode & 0o077) !== 0) throw new CliAdmissionError('manifest_not_private');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new CliAdmissionError('manifest_invalid');
  }
}

export function admitOutputPath(outputPath: string): string {
  const full = resolve(outputPath);
  const dir = dirname(full);
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new CliAdmissionError('output_directory_missing');
  }
  if (!st.isDirectory() || (st.mode & 0o077) !== 0)
    throw new CliAdmissionError('output_directory_not_private');
  return full;
}

/** Atomic private publish: complete serialization first, then rename; never a partial credential-bearing file. */
export function writePrivateOutput(finalPath: string, text: string): void {
  if (Buffer.byteLength(text, 'utf8') > OUTPUT_MAX_BYTES)
    throw new CliAdmissionError('output_too_large');
  const tmp = join(dirname(finalPath), `.${randomUUID()}.tmp`);
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  chmodSync(tmp, 0o600);
  renameSync(tmp, finalPath);
}

export interface Authority {
  membershipRole: string | null;
  capabilities: {
    can(module: string, action: string): boolean;
    ownerScoped(module: string): boolean;
    fieldLevel(module: string): number;
  };
}

/** stock/pos/finance view with finance field tier (stock has no tier of its own); owner for asserted intent. */
export function checkDiagnosticAuthority(
  caps: Authority,
  sensitiveLevel: number,
  modules: readonly { module_id: string; enabled: boolean }[],
  manifest: DiagnosticManifestV1,
  profileId: string,
): void {
  const c = caps.capabilities;
  const enabled = (id: string) => modules.some((m) => m.module_id === id && m.enabled === true);
  if (!['stock', 'pos', 'finances'].every(enabled))
    throw new CliAdmissionError('required_module_disabled');
  if (
    !(c.can('stock', 'view') && c.can('pos', 'view') && c.can('finance', 'view')) ||
    c.ownerScoped('stock') ||
    c.ownerScoped('pos') ||
    c.ownerScoped('finance') ||
    c.fieldLevel('finance') < sensitiveLevel
  )
    throw new CliAdmissionError('insufficient_authority');
  const asserts = manifest.cases.some((k) =>
    k.evidenceRefs.some(
      (r) => r.assertion !== null && r.assertion.verifiedByProfileId !== profileId,
    ),
  );
  const anyAssertion = manifest.cases.some((k) => k.evidenceRefs.some((r) => r.assertion !== null));
  if (anyAssertion && (caps.membershipRole !== 'owner' || asserts))
    throw new CliAdmissionError('owner_required_for_assertion');
}

function gitSha(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    /* fall through */
  }
  throw new CliAdmissionError('source_sha_unavailable');
}

export async function run(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    const args = parseArgs(argv);
    const manifest = decodeDiagnosticManifestV1(readPrivateJson(args.manifestPath));
    const outputPath = admitOutputPath(args.outputPath);
    const url = env.FACES_STOCK_DATABASE_URL;
    const token = env.FACES_OPERATOR_ACCESS_TOKEN;
    const anonKey = env.FACES_OPERATOR_ANON_KEY;
    if (!url || !token || !anonKey) throw new CliAdmissionError('missing_private_input');
    if (
      operatorDatabaseIdentity(url, manifest.target.authProject) !==
      manifest.target.databaseIdentity
    )
      throw new CliAdmissionError('database_identity_mismatch');
    // Token verification precedes any application import or business read.
    const principal = await verifyOperatorPrincipal({
      accessToken: token,
      authUrl: manifest.target.authUrl,
      trustedAuthUrl: env.FACES_OPERATOR_AUTH_URL,
      anonKey,
      expectedProfileId: manifest.actorProfileId,
      targetFingerprint: manifest.target,
    });
    const sha = gitSha();
    const { createOperatorServiceLoader } = await import('./lib/operator-service-loader');
    const loader = await createOperatorServiceLoader({ principal, target: manifest.target });
    const postgresModule = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { sql } = await import('drizzle-orm');
    const read = await import('./lib/faces-stock-reconcile-read');
    const reportLib = await import('./lib/faces-stock-reconcile-report');
    let client: ReturnType<typeof postgresModule.default> | undefined;
    try {
      const [orgCore, pgPool, rbac, bridge] = await Promise.all([
        loader.load('orgCore'),
        loader.load('pgPool'),
        loader.load('rbac'),
        loader.load('activeOperatorPrincipal'),
      ]);
      const perms = await import('../src/lib/permissions');
      const host = new URL(url).hostname;
      const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(host);
      client = postgresModule.default(url, {
        max: 1,
        prepare: false,
        fetch_types: false,
        types: pgPool.ARRAY_TYPES as unknown as Record<string, import('postgres').PostgresType>,
        ssl: remote ? { rejectUnauthorized: true, servername: host } : false,
        connection: {
          statement_timeout: read.LIMITS.statementMs,
          application_name: 'faces-stock-reconcile',
        },
      });
      const db = drizzle(client);
      type Tx = Parameters<typeof orgCore.applyOrgTxScope>[0];
      const observedAt = new Date().toISOString().replace('Z', '000Z');
      const report = await db.transaction(
        async (rawTx) => {
          const tx = rawTx as unknown as Tx;
          await tx.execute(sql`set local time zone 'UTC'`);
          await tx.execute(sql`set local lock_timeout = '1s'`);
          await orgCore.applyOrgTxScope(tx, args.org, principal.profileId);
          const [ident] = await tx.execute<{
            db: string;
            ro: string;
            snap: string;
            started: string;
            role: string;
          }>(
            sql`select current_database() as db, current_setting('transaction_read_only') as ro, pg_current_snapshot()::text as snap,
                to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started, current_setting('role') as role`,
          );
          if (ident?.db !== decodeURIComponent(new URL(url).pathname.slice(1)) || ident.ro !== 'on')
            throw new CliAdmissionError('connection_identity_mismatch');
          await bridge.assertActiveOperatorPrincipalReadOnlyInTx(tx, args.org, principal.profileId);
          const caps = await rbac.resolveFreshCapabilitiesReadOnlyInTransaction(
            tx,
            args.org,
            principal.profileId,
          );
          const modules = await tx.execute<{ module_id: string; enabled: boolean }>(
            sql`select module_id, enabled from public.app_modules where org_id = ${args.org} and module_id in ('pos','finances','stock')`,
          );
          checkDiagnosticAuthority(
            caps as unknown as Authority,
            perms.SENSITIVE_FIELD_LEVEL,
            [...modules],
            manifest,
            principal.profileId,
          );
          const deadline = read.makeDeadline(TOTAL_MS);
          const base = {
            orgId: args.org,
            manifest,
            observedAt,
            gitSha: sha,
            snapshot: {
              id: ident.snap,
              startedAt: ident.started,
              role: 'app_ledger' as const,
              orgId: args.org,
              profileId: principal.profileId,
              readOnly: true as const,
            },
          };
          try {
            const assertedKeys = manifest.cases.flatMap((k) =>
              k.evidenceRefs.flatMap((r) =>
                r.assertion?.kind === 'expected_component'
                  ? [
                      {
                        itemId: r.assertion.component.itemId,
                        warehouseId: r.assertion.component.warehouseId,
                      },
                    ]
                  : [],
              ),
            );
            const collected = await read.collectEvidence(
              (q) => tx.execute(q) as unknown as Promise<Record<string, unknown>[]>,
              args.org,
              manifest.cases,
              assertedKeys,
              deadline,
            );
            // Read-only and role/scope are rechecked before the report is finalized.
            const [again] = await tx.execute<{ ro: string; org: string }>(
              sql`select current_setting('transaction_read_only') as ro, current_setting('app.current_org_id', true) as org`,
            );
            if (again?.ro !== 'on' || again.org !== args.org)
              throw new CliAdmissionError('scope_changed');
            return reportLib.buildReport({ ...base, collected, mappingQualified: false });
          } catch (error) {
            if (error instanceof CliAdmissionError) throw error;
            const code =
              error instanceof read.ReadFailure
                ? error.code
                : error instanceof ReconciliationError && error.code === 'numeric_unsupported'
                  ? 'unsupported_numeric'
                  : 'read_failed';
            return reportLib.buildIncompleteReport(base, code);
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      let text = `${canonicalJson(report)}\n`;
      if (Buffer.byteLength(text, 'utf8') > OUTPUT_MAX_BYTES) {
        text = `${canonicalJson(reportLib.buildIncompleteReport({ orgId: args.org, manifest, observedAt, gitSha: sha, snapshot: report.snapshot }, 'capacity'))}\n`;
        writePrivateOutput(outputPath, text);
        console.log(JSON.stringify({ outcome: 'incomplete', output: outputPath }));
        return 3;
      }
      writePrivateOutput(outputPath, text);
      console.log(
        JSON.stringify({ outcome: report.outcome, cases: report.cases.length, output: outputPath }),
      );
      return reportLib.EXIT_FOR_OUTCOME[report.outcome];
    } finally {
      await client?.end({ timeout: 5 });
      await loader.close();
    }
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (
      error instanceof CliAdmissionError ||
      error instanceof ReconciliationError ||
      name === 'OperatorPrincipalError' ||
      name === 'OperatorAuthorityError'
    ) {
      console.error(`refused: ${(error as { code?: string }).code ?? (error as Error).message}`);
      return 2;
    }
    console.error('diagnostic incomplete: no report was written');
    return 3;
  }
}

if (import.meta.main && existsSync(process.argv[1] ?? ''))
  process.exit(await run(process.argv.slice(2), process.env));
