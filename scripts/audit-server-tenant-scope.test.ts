import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClient as createLibsqlClient } from '@libsql/client';
import {
  auditTenantScope,
  collectCanonicalOrgIds,
  formatAuditCounters,
} from './audit-server-tenant-scope.lib';

const AUDIT_SCRIPT = path.resolve(import.meta.dirname, 'audit-server-tenant-scope.ts');
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
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['--no-env-file', AUDIT_SCRIPT], { cwd, env });
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
