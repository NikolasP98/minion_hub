import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClient as createLibsqlClient } from '@libsql/client';
import {
  auditTenantScope,
  collectCanonicalOrgIds,
  formatAuditCounters,
  formatReadinessReport,
  parseRekeyCliArgs,
  recordAuditRun,
  REQUIRED_AUDIT_ENVIRONMENTS,
  rekeyReadinessGateFailures,
  rekeyReadinessReport,
  updateServerIsTenantScoped,
} from './audit-server-tenant-scope.lib';

const AUDIT_SCRIPT = path.resolve(import.meta.dirname, 'audit-server-tenant-scope.ts');
const STATUS_SCRIPT = path.resolve(import.meta.dirname, 'rekey-readiness-status.ts');
const CREDENTIAL_KEYS = [
  'TURSO_DB_URL',
  'TURSO_DB_AUTH_TOKEN',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

describe('server tenant-scope audit command', () => {
  it('ignores repository dotenv credentials and aborts before connecting', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tenant-scope-audit-'));
    try {
      await writeFile(
        path.join(root, '.env'),
        [
          'TURSO_DB_URL=libsql://dotenv.invalid',
          'TURSO_DB_AUTH_TOKEN=dotenv-token',
          'PUBLIC_SUPABASE_URL=https://dotenv.invalid',
          'SUPABASE_SERVICE_ROLE_KEY=dotenv-service-role',
          '',
        ].join('\n'),
      );
      const env = { ...process.env };
      for (const key of CREDENTIAL_KEYS) delete env[key];

      const result = spawnSync('bun', ['--no-env-file', AUDIT_SCRIPT], {
        cwd: root,
        env,
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'TURSO_DB_URL and TURSO_DB_AUTH_TOKEN must be set',
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain('fetch failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Fixture rehearsal of the comparison rules the production run depends on.
// Exercises the shipped comparator in ./audit-server-tenant-scope.lib.ts, so the
// first time it decides a security/data merge gate is not the first time it runs.
describe('auditTenantScope comparison rules', () => {
  const orgIds = new Set(['org-a', 'org-b']);

  it('passes when every tenant id matches, including several servers per tenant', () => {
    const result = auditTenantScope({
      serverRows: [
        { id: 's1', tenantId: 'org-a' },
        { id: 's2', tenantId: 'org-a' },
        { id: 's3', tenantId: 'org-b' },
      ],
      orgIds,
    });

    expect(formatAuditCounters(result)).toBe(
      'turso_server_rows=3 null_tenant_ids=0 unmatched_tenant_ids=0',
    );
    expect(result.failReasons).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('counts null and empty-string tenant ids as null, not as unmatched', () => {
    const result = auditTenantScope({
      serverRows: [
        { id: 's1', tenantId: null },
        { id: 's2', tenantId: '' },
        { id: 's3', tenantId: 'org-a' },
      ],
      orgIds,
    });

    expect(formatAuditCounters(result)).toBe(
      'turso_server_rows=3 null_tenant_ids=2 unmatched_tenant_ids=0',
    );
    expect(result.pass).toBe(false);
  });

  it('flags legacy tenant keys by exact string equality and samples their server ids', () => {
    const result = auditTenantScope({
      serverRows: [
        { id: 's1', tenantId: 'legacy-better-auth-uuid' },
        { id: 's2', tenantId: 'ORG-A' }, // case differences are not matches
        { id: 's3', tenantId: 'org-a ' }, // nor is trailing whitespace
        { id: 's4', tenantId: 'org-a' },
      ],
      orgIds,
    });

    expect(formatAuditCounters(result)).toBe(
      'turso_server_rows=4 null_tenant_ids=0 unmatched_tenant_ids=3',
    );
    expect(result.unmatchedSample).toEqual(['s1', 's2', 's3']);
    expect(result.pass).toBe(false);
  });

  it('caps the unmatched sample at ten server ids', () => {
    const result = auditTenantScope({
      serverRows: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, tenantId: 'legacy' })),
      orgIds,
    });

    expect(result.unmatchedTenantIds).toBe(25);
    expect(result.unmatchedSample).toHaveLength(10);
  });

  it('fails closed when it inspected zero Turso servers rows', () => {
    const result = auditTenantScope({ serverRows: [], orgIds });

    expect(formatAuditCounters(result)).toBe(
      'turso_server_rows=0 null_tenant_ids=0 unmatched_tenant_ids=0',
    );
    expect(result.pass).toBe(false);
    expect(result.failReasons.join(' ')).toContain('0 Turso servers rows');
  });

  it('fails closed when it read zero canonical organizations', () => {
    const result = auditTenantScope({
      serverRows: [{ id: 's1', tenantId: 'org-a' }],
      orgIds: new Set<string>(),
    });

    expect(result.pass).toBe(false);
    expect(result.failReasons.join(' ')).toContain('0 canonical Supabase organizations');
  });
});

describe('collectCanonicalOrgIds pagination', () => {
  it('requests another page when the previous one filled exactly, and stops on the empty page', async () => {
    const pages = [['org-1', 'org-2'], ['org-3', 'org-4'], []];
    const requested: Array<[number, number]> = [];

    const orgIds = await collectCanonicalOrgIds(async (offset, limit) => {
      requested.push([offset, limit]);
      return pages[offset / limit] ?? [];
    }, 2);

    expect(requested).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
    expect([...orgIds]).toEqual(['org-1', 'org-2', 'org-3', 'org-4']);
  });

  it('stops on the first short page without a further request', async () => {
    const requested: number[] = [];

    const orgIds = await collectCanonicalOrgIds(async (offset) => {
      requested.push(offset);
      return offset === 0 ? ['org-1'] : ['unreachable'];
    }, 2);

    expect(requested).toEqual([0]);
    expect([...orgIds]).toEqual(['org-1']);
  });
});

// End-to-end rehearsal of the shipped command: a throwaway local SQLite file
// stands in for Turso and a stub PostgREST endpoint stands in for Supabase, so
// the script's real wiring (schema import, libsql read, supabase-js paging,
// counters, exit codes) is proven before a credential holder points it at a
// real environment. This is NOT the spec's non-production/production audit
// evidence — see the TODO(handoff) in scripts/audit-server-tenant-scope.ts.
/**
 * `spawnSync` would block this thread's event loop and deadlock against the
 * in-process stub PostgREST server below, so the rehearsal spawns the command
 * asynchronously and drains its streams.
 */
function runAudit(
  env: NodeJS.ProcessEnv,
  cwd: string,
  args: string[] = [],
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['--no-env-file', AUDIT_SCRIPT, ...args], { cwd, env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

async function withRehearsalEnvironment(
  serverRows: Array<{ id: string; tenantId: string }>,
  orgIds: string[],
  run: (env: NodeJS.ProcessEnv, cwd: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tenant-scope-rehearsal-'));
  const dbPath = path.join(root, 'audit.db');
  const libsql = createLibsqlClient({ url: `file:${dbPath}` });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.endsWith('/organizations')) {
      res.writeHead(404).end('[]');
      return;
    }
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? String(orgIds.length));
    const page = [...orgIds].sort().slice(offset, offset + limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(page.map((id) => ({ id }))));
  });

  try {
    await libsql.execute(
      `create table servers (
         id text primary key,
         tenant_id text not null,
         name text not null,
         url text not null,
         token text not null default '',
         token_iv text not null default '',
         auth_mode text not null default 'token',
         last_connected_at integer,
         created_at integer not null,
         updated_at integer not null
       )`,
    );
    for (const row of serverRows) {
      await libsql.execute({
        sql: 'insert into servers (id, tenant_id, name, url, created_at, updated_at) values (?, ?, ?, ?, 1, 1)',
        args: [row.id, row.tenantId, row.id, `https://${row.id}.example.com`],
      });
    }
    libsql.close();

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('stub server has no port');

    await run(
      {
        ...process.env,
        TURSO_DB_URL: `file:${dbPath}`,
        TURSO_DB_AUTH_TOKEN: 'rehearsal-token',
        PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'rehearsal-service-role',
      },
      root,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

describe('server tenant-scope audit rehearsal (local stand-ins, not spec evidence)', () => {
  it('reports zero mismatches and exits 0 when every tenant id is canonical', async () => {
    await withRehearsalEnvironment(
      [
        { id: 's1', tenantId: 'org-a' },
        { id: 's2', tenantId: 'org-a' },
        { id: 's3', tenantId: 'org-b' },
      ],
      ['org-a', 'org-b'],
      async (env, cwd) => {
        const result = await runAudit(env, cwd);
        const output = result.output;

        expect(output).toContain('turso_server_rows=3 null_tenant_ids=0 unmatched_tenant_ids=0');
        expect(output).toContain('[audit] PASS');
        expect(result.status).toBe(0);
      },
    );
  }, 60_000);

  it('reports the legacy tenant key and exits 1 when a row is not re-keyed', async () => {
    await withRehearsalEnvironment(
      [
        { id: 's1', tenantId: 'org-a' },
        { id: 's2', tenantId: 'legacy-better-auth-uuid' },
      ],
      ['org-a', 'org-b'],
      async (env, cwd) => {
        const result = await runAudit(env, cwd);
        const output = result.output;

        expect(output).toContain('turso_server_rows=2 null_tenant_ids=0 unmatched_tenant_ids=1');
        expect(output).toContain('sample unmatched server ids: s2');
        expect(output).toContain('[audit] FAIL');
        expect(result.status).toBe(1);
      },
    );
  }, 60_000);
});

// The gate that keeps the parked predicate parked. These fixtures are what
// makes it more than a comment: they prove it actually reds when the predicate
// lands without evidence, which is a state the repository is never in on this
// branch and so would otherwise never be exercised.
describe('re-key readiness gate rules', () => {
  const passingRun = (environment: string) => ({
    environment,
    recordedAt: '2026-08-20T09:00:00Z',
    recordedBy: 'credential-holder',
    command: 'bun run audit:server-tenant-scope',
    tursoServerRows: 7,
    nullTenantIds: 0,
    unmatchedTenantIds: 0,
  });
  const completeEvidence = () => ({
    schemaVersion: 1,
    runs: REQUIRED_AUDIT_ENVIRONMENTS.map(passingRun),
    rekeyRecord: {
      identifier: '20260812_rekey_servers_tenant_id',
      appliedAt: '2026-08-12T00:00:00Z',
      applyEvidence: 'https://example.invalid/deployment/1234',
      rollbackNote: 'Restore from the pre-apply Turso snapshot; see the re-key owner.',
    },
  });

  it('passes with no evidence while updateServer carries no tenant predicate', () => {
    expect(
      rekeyReadinessGateFailures({ predicateIsTenantScoped: false, evidence: undefined }),
    ).toEqual([]);
  });

  it('stays quiet on a partially recorded file while the predicate is parked', () => {
    const partial = completeEvidence();
    partial.runs = [partial.runs[0]];
    expect(
      rekeyReadinessGateFailures({ predicateIsTenantScoped: false, evidence: partial }),
    ).toEqual([]);
  });

  // The converse of the stop rule. A one-way gate goes permanently quiet the
  // moment the evidence lands, and would then report "fine" for the very
  // cross-tenant write the evidence was gathered in order to close.
  it('blocks complete evidence that ships with an unscoped mutation', () => {
    const failures = rekeyReadinessGateFailures({
      predicateIsTenantScoped: false,
      evidence: completeEvidence(),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('still mutates by servers.id alone');
  });

  it('blocks a tenant-scoped predicate that ships with no evidence at all', () => {
    const failures = rekeyReadinessGateFailures({
      predicateIsTenantScoped: true,
      evidence: undefined,
    });
    expect(failures[0]).toContain('no re-key readiness evidence is recorded');
    // Not just a summary line: an absent file still enumerates every artifact it owes.
    expect(failures).toContain('no recorded audit run for the non-production environment');
    expect(failures).toContain('no recorded audit run for the production environment');
    expect(failures).toContain('re-key readiness evidence has no `rekeyRecord`');
  });

  it('accepts a tenant-scoped predicate backed by both audits and the re-key record', () => {
    expect(
      rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence: completeEvidence() }),
    ).toEqual([]);
  });

  it('blocks when only one environment was audited', () => {
    const evidence = completeEvidence();
    evidence.runs = evidence.runs.filter((run) => run.environment !== 'production');
    expect(rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence })).toEqual([
      'no recorded audit run for the production environment',
    ]);
  });

  it('blocks a recorded run that inspected zero rows, matching the audit fail-closed rule', () => {
    const evidence = completeEvidence();
    evidence.runs[0].tursoServerRows = 0;
    expect(rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence })).toEqual([
      'non-production audit run must record a non-zero turso_server_rows (it proves nothing otherwise)',
    ]);
  });

  it('blocks a recorded run with a non-zero mismatch counter', () => {
    const evidence = completeEvidence();
    evidence.runs[1].unmatchedTenantIds = 3;
    expect(rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence })).toEqual([
      'production audit run must record unmatched_tenant_ids=0, got 3',
    ]);
  });

  it('blocks passing audits that carry no concrete re-key record', () => {
    const evidence = completeEvidence();
    evidence.rekeyRecord.identifier = '';
    evidence.rekeyRecord.rollbackNote = '   ';
    expect(rekeyReadinessGateFailures({ predicateIsTenantScoped: true, evidence })).toEqual([
      'rekeyRecord is missing identifier',
      'rekeyRecord is missing rollbackNote',
    ]);
  });
});

/**
 * `updateServerIsTenantScoped` answers one question — does the UPDATE that
 * `updateServer` issues filter on `servers.tenantId`? — and the expensive way to
 * get it wrong is a false *positive*: certifying a mutation as tenant-scoped
 * when the column is only mentioned nearby. Every case below that expects
 * `false` while containing the literal text `servers.tenantId` is a regression
 * against exactly that, because each one leaves the cross-tenant write live.
 */
describe('updateServerIsTenantScoped', () => {
  const wrap = (body: string) => `
export async function updateServer(ctx: TenantContext, id: string) {
${body}
}
export async function upsertServer(ctx: TenantContext) {
  await ctx.db.insert(servers).values({ tenantId: ctx.tenantId });
}
`;

  it('detects the tenant predicate in the update’s where clause', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(
          '  await ctx.db.update(servers).set({}).where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));',
        ),
      ),
    ).toBe(true);
  });

  it('detects it through a formatter-broken multi-line chain', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  await ctx.db
    .update( servers )
    .set({})
    .where(
      and(eq(servers.id, id), eq(servers . tenantId, ctx.tenantId)),
    );`),
      ),
    ).toBe(true);
  });

  it('rejects an update filtered by id alone', () => {
    expect(
      updateServerIsTenantScoped(
        wrap('  await ctx.db.update(servers).set({}).where(eq(servers.id, id));'),
      ),
    ).toBe(false);
  });

  it('scopes its answer to updateServer, not to its tenant-scoped siblings', () => {
    const source = `
export async function deleteServer(ctx: TenantContext, id: string) {
  await ctx.db.delete(servers).where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
}
export async function updateServer(ctx: TenantContext, id: string) {
  await ctx.db.update(servers).set({}).where(eq(servers.id, id));
}
export async function touchServer(ctx: TenantContext, id: string) {
  await ctx.db.update(servers).set({}).where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
}
`;
    expect(updateServerIsTenantScoped(source)).toBe(false);
  });

  // The four false-positive shapes a whole-body text search cannot tell apart
  // from the predicate itself. Each ships the same id-only UPDATE.
  it('is not fooled by a comment naming the predicate that was never added', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  // TODO: add eq(servers.tenantId, ctx.tenantId) once the rows are re-keyed.
  /* see servers.tenantId in the runbook */
  await ctx.db.update(servers).set({}).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  it('is not fooled by a string literal or a log line mentioning the column', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  const scopeColumn = 'servers.tenantId';
  console.log(\`scoping on \${scopeColumn} is pending\`, servers.tenantId);
  await ctx.db.update(servers).set({}).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  it('is not fooled by an assignment that carries the column into the set object', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  const set: Record<string, unknown> = { tenantId: servers.tenantId };
  await ctx.db.update(servers).set(set).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  it('is not fooled by a tenant-scoped read sitting above an unscoped update', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  const [row] = await ctx.db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
  if (!row) return;
  await ctx.db.update(servers).set({}).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  it('is not fooled by another table’s tenant-scoped update in the same body', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  await ctx.db.update(userServers).set({}).where(eq(servers.tenantId, ctx.tenantId));
  await ctx.db.update(servers).set({}).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  // Fail-closed shapes: nothing here says "tenant-scoped", so nothing may.
  it('rejects an update with no where clause at all', () => {
    expect(updateServerIsTenantScoped(wrap('  await ctx.db.update(servers).set({});'))).toBe(false);
  });

  it('rejects a chain whose where clause is applied through a separate binding', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  const query = ctx.db.update(servers).set({});
  await query.where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));`),
      ),
    ).toBe(false);
  });

  it('requires every update(servers) in the body to be scoped, not just one', () => {
    expect(
      updateServerIsTenantScoped(
        wrap(`  await ctx.db.update(servers).set({}).where(and(eq(servers.id, id), eq(servers.tenantId, ctx.tenantId)));
  await ctx.db.update(servers).set({ updatedAt: 1 }).where(eq(servers.id, id));`),
      ),
    ).toBe(false);
  });

  it('throws rather than silently passing when updateServer moves out of the file', () => {
    expect(() => updateServerIsTenantScoped('export const nothing = 1;\n')).toThrow(
      /anchored to a symbol that moved/,
    );
  });

  it('throws rather than silently passing when the update(servers) itself moves out', () => {
    expect(() => updateServerIsTenantScoped(wrap('  await updateServerRow(ctx, id);'))).toThrow(
      /anchored to a shape that moved/,
    );
  });
});

// `--record` exists because hand-transcribing three counters into JSON is the one
// step of this gate where a typo silently changes the answer. These fixtures pin
// what it will and will not write.
describe('recordAuditRun', () => {
  const passingRun = (environment: string) => ({
    environment,
    recordedAt: '2026-08-20T09:00:00Z',
    recordedBy: 'credential-holder',
    command: `bun run audit:server-tenant-scope -- --record ${environment}`,
    tursoServerRows: 7,
    nullTenantIds: 0,
    unmatchedTenantIds: 0,
  });

  it('creates the evidence file shape with a blank re-key record to fill in', () => {
    const evidence = recordAuditRun(undefined, passingRun('non-production'));

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.runs).toEqual([passingRun('non-production')]);
    expect(evidence.rekeyRecord).toEqual({
      identifier: '',
      appliedAt: '',
      applyEvidence: '',
      rollbackNote: '',
    });
    // A file with one run recorded is still BLOCKED — it is progress, not readiness.
    expect(rekeyReadinessReport(evidence).status).toBe('BLOCKED');
  });

  it('keeps the other environment and the human-written re-key record', () => {
    const first = recordAuditRun(undefined, passingRun('non-production'));
    first.rekeyRecord = {
      identifier: '20260812_rekey_servers_tenant_id',
      appliedAt: '2026-08-12T00:00:00Z',
      applyEvidence: 'https://example.invalid/deployment/1234',
      rollbackNote: 'Restore from the pre-apply Turso snapshot.',
    };

    const second = recordAuditRun(first, passingRun('production'));

    expect(second.runs.map((run) => run.environment)).toEqual([...REQUIRED_AUDIT_ENVIRONMENTS]);
    expect(second.rekeyRecord).toEqual(first.rekeyRecord);
    expect(rekeyReadinessReport(second)).toEqual({ status: 'READY', missing: [] });
  });

  it('replaces a re-run of the same environment rather than appending a second entry', () => {
    const first = recordAuditRun(undefined, passingRun('production'));
    const rerun = { ...passingRun('production'), recordedAt: '2026-08-21T09:00:00Z' };

    const second = recordAuditRun(first, rerun);

    expect(second.runs).toEqual([rerun]);
  });

  it('refuses to record a run the gate would reject, so no file implies a done step', () => {
    expect(() =>
      recordAuditRun(undefined, { ...passingRun('production'), tursoServerRows: 0 }),
    ).toThrow(/non-zero turso_server_rows/);
    expect(() =>
      recordAuditRun(undefined, { ...passingRun('production'), unmatchedTenantIds: 2 }),
    ).toThrow(/unmatched_tenant_ids=0, got 2/);
  });

  it('refuses an environment name the gate will never look for', () => {
    expect(() => recordAuditRun(undefined, passingRun('prod'))).toThrow(/unknown environment/);
  });

  it('refuses to overwrite an evidence file that is not a JSON object', () => {
    expect(() => recordAuditRun('nonsense', passingRun('production'))).toThrow(/not a JSON object/);
  });
});

describe('parseRekeyCliArgs', () => {
  it('accepts the two documented flags', () => {
    expect(
      parseRekeyCliArgs(['--record', 'production', '--evidence', '/tmp/e.json'], {
        allowRecord: true,
      }),
    ).toEqual({ recordEnvironment: 'production', evidencePath: '/tmp/e.json' });
  });

  it('aborts on an environment name the gate will never look for', () => {
    expect(() => parseRekeyCliArgs(['--record', 'prod'], { allowRecord: true })).toThrow(
      /not one of the environments/,
    );
  });

  it('aborts on a --record with no value instead of silently recording nothing', () => {
    expect(() => parseRekeyCliArgs(['--record'], { allowRecord: true })).toThrow(
      /--record needs an environment/,
    );
  });

  it('rejects --record for the read-only status command', () => {
    expect(() => parseRekeyCliArgs(['--record', 'production'], { allowRecord: false })).toThrow(
      /unknown argument/,
    );
  });
});

describe('rekeyReadinessReport', () => {
  it('reports BLOCKED with every missing artifact when nothing is recorded', () => {
    const report = rekeyReadinessReport(undefined);

    expect(formatReadinessReport(report)).toBe('rekey_readiness=BLOCKED missing=5');
    expect(report.missing).toContain('no recorded audit run for the production environment');
  });

  it('asks unconditionally, unlike the gate, which stays quiet while the predicate is parked', () => {
    expect(
      rekeyReadinessGateFailures({ predicateIsTenantScoped: false, evidence: undefined }).length,
    ).toBe(0);
    expect(rekeyReadinessReport(undefined).status).toBe('BLOCKED');
  });
});

describe('rekey readiness status command', () => {
  function runStatus(args: string[]): { status: number | null; output: string } {
    const result = spawnSync('bun', ['--no-env-file', STATUS_SCRIPT, ...args], {
      encoding: 'utf8',
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('exits 1 and names the missing artifacts when no evidence file exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rekey-status-'));
    try {
      const result = runStatus(['--evidence', path.join(root, 'evidence.json')]);

      expect(result.status).toBe(1);
      expect(result.output).toContain('rekey_readiness=BLOCKED');
      expect(result.output).toContain('no recorded audit run for the non-production environment');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exits 0 only once both runs and the re-key record are recorded', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rekey-status-'));
    const evidencePath = path.join(root, 'evidence.json');
    try {
      let evidence = recordAuditRun(undefined, {
        environment: 'non-production',
        recordedAt: '2026-08-20T09:00:00Z',
        recordedBy: 'credential-holder',
        command: 'bun run audit:server-tenant-scope -- --record non-production',
        tursoServerRows: 3,
        nullTenantIds: 0,
        unmatchedTenantIds: 0,
      });
      await writeFile(evidencePath, JSON.stringify(evidence));
      expect(runStatus(['--evidence', evidencePath]).status).toBe(1);

      evidence = recordAuditRun(evidence, {
        environment: 'production',
        recordedAt: '2026-08-20T10:00:00Z',
        recordedBy: 'credential-holder',
        command: 'bun run audit:server-tenant-scope -- --record production',
        tursoServerRows: 9,
        nullTenantIds: 0,
        unmatchedTenantIds: 0,
      });
      evidence.rekeyRecord = {
        identifier: '20260812_rekey_servers_tenant_id',
        appliedAt: '2026-08-12T00:00:00Z',
        applyEvidence: 'https://example.invalid/deployment/1234',
        rollbackNote: 'Restore from the pre-apply Turso snapshot.',
      };
      await writeFile(evidencePath, JSON.stringify(evidence));

      const result = runStatus(['--evidence', evidencePath]);
      expect(result.status).toBe(0);
      expect(result.output).toContain('rekey_readiness=READY missing=0');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// The recording half of the rehearsal: proves the shipped command writes the
// counters it actually produced, and writes nothing at all when the audit fails.
describe('server tenant-scope audit --record (local stand-ins, not spec evidence)', () => {
  it('writes the real counters for the named environment after a passing run', async () => {
    await withRehearsalEnvironment(
      [
        { id: 's1', tenantId: 'org-a' },
        { id: 's2', tenantId: 'org-b' },
      ],
      ['org-a', 'org-b'],
      async (env, cwd) => {
        const evidencePath = path.join(cwd, 'nested/evidence.json');
        const result = await runAudit(env, cwd, [
          '--record',
          'non-production',
          '--evidence',
          evidencePath,
        ]);

        expect(result.status).toBe(0);
        expect(result.output).toContain(`recorded the non-production run in ${evidencePath}`);

        const recorded = JSON.parse(await readFile(evidencePath, 'utf8'));
        expect(recorded.runs).toHaveLength(1);
        expect(recorded.runs[0]).toMatchObject({
          environment: 'non-production',
          tursoServerRows: 2,
          nullTenantIds: 0,
          unmatchedTenantIds: 0,
        });
        expect(recorded.runs[0].recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(recorded.runs[0].recordedBy).not.toBe('');
        // One environment recorded is not readiness.
        expect(rekeyReadinessReport(recorded).status).toBe('BLOCKED');
      },
    );
  }, 60_000);

  it('records nothing when the audit fails, so a written file always means a passing run', async () => {
    await withRehearsalEnvironment(
      [
        { id: 's1', tenantId: 'org-a' },
        { id: 's2', tenantId: 'legacy-better-auth-uuid' },
      ],
      ['org-a', 'org-b'],
      async (env, cwd) => {
        const evidencePath = path.join(cwd, 'evidence.json');
        const result = await runAudit(env, cwd, [
          '--record',
          'production',
          '--evidence',
          evidencePath,
        ]);

        expect(result.status).toBe(1);
        expect(existsSync(evidencePath)).toBe(false);
      },
    );
  }, 60_000);
});
