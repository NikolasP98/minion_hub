// Bun-only: this suite exercises bun:sqlite and must not be discovered by Vitest.
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  markArtifact,
  openReconDatabase,
  scanArchitecture,
  type ReconArtifact,
} from './architecture-recon-index';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ root: string; dbPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'minion-architecture-recon-'));
  temporaryDirectories.push(root);
  const dbPath = join(root, '.state', 'recon.sqlite');
  await mkdir(join(root, 'hub', 'src', 'services'), { recursive: true });
  await writeFile(join(root, 'hub', 'package.json'), '{"name":"hub"}\n');
  await writeFile(join(root, 'hub', 'src', 'services', 'health.ts'), 'export const ok = true;\n');
  return { root, dbPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('architecture recon index', () => {
  test('builds a resumable C4 hierarchy and only records real changes', async () => {
    const { root, dbPath } = await fixture();
    const first = await scanArchitecture({ root, dbPath, now: '2026-07-24T00:00:00.000Z' });

    expect(first.added).toBe(6);
    expect(first.modified).toBe(0);
    expect(first.missing).toBe(0);

    const db = openReconDatabase(dbPath);
    const rows = db
      .query<ReconArtifact, []>(
        `SELECT path, kind, c4_level, parent_path, recon_status, scan_status,
				        content_hash, size_bytes, mtime_ms
				 FROM artifacts ORDER BY path`,
      )
      .all();
    db.close();
    expect(
      rows.map(({ path, c4_level, parent_path }) => ({ path, c4_level, parent_path })),
    ).toEqual([
      { path: '.', c4_level: 'context', parent_path: null },
      { path: 'hub', c4_level: 'container', parent_path: '.' },
      { path: 'hub/package.json', c4_level: 'code', parent_path: 'hub' },
      { path: 'hub/src', c4_level: 'component', parent_path: 'hub' },
      { path: 'hub/src/services', c4_level: 'component', parent_path: 'hub/src' },
      {
        path: 'hub/src/services/health.ts',
        c4_level: 'code',
        parent_path: 'hub/src/services',
      },
    ]);

    const second = await scanArchitecture({ root, dbPath, now: '2026-07-24T00:01:00.000Z' });
    expect(second.added).toBe(0);
    expect(second.modified).toBe(0);
    expect(second.unchanged).toBe(first.artifacts);

    const changesDb = new Database(dbPath);
    const changeCount = changesDb
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM artifact_changes')
      .get();
    changesDb.close();
    expect(changeCount?.count).toBe(first.artifacts);
  });

  test('detects modifications, reopens verified recon, and preserves manual hierarchy metadata', async () => {
    const { root, dbPath } = await fixture();
    await scanArchitecture({ root, dbPath, now: '2026-07-24T00:00:00.000Z' });
    markArtifact(dbPath, 'hub/src/services/health.ts', {
      status: 'verified',
      level: 'component',
      parent: 'hub',
    });

    await writeFile(
      join(root, 'hub', 'src', 'services', 'health.ts'),
      'export const ok = false;\n',
    );
    await rm(join(root, 'hub', 'package.json'));
    const next = await scanArchitecture({
      root,
      dbPath,
      now: '2026-07-24T00:02:00.000Z',
      rehash: true,
    });

    expect(next.modified).toBe(1);
    expect(next.missing).toBe(1);
    const db = new Database(dbPath);
    const health = db
      .query<ReconArtifact, [string]>(
        `SELECT path, kind, c4_level, parent_path, recon_status, scan_status,
				        content_hash, size_bytes, mtime_ms
				 FROM artifacts WHERE path = ?`,
      )
      .get('hub/src/services/health.ts');
    const missing = db
      .query<{ scan_status: string }, [string]>('SELECT scan_status FROM artifacts WHERE path = ?')
      .get('hub/package.json');
    db.close();

    expect(health).toMatchObject({
      c4_level: 'component',
      parent_path: 'hub',
      recon_status: 'in_review',
      scan_status: 'current',
    });
    expect(missing?.scan_status).toBe('missing');
  });

  test('indexes source symbols, imports, HTTP endpoints, and gateway contracts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'minion-architecture-deep-recon-'));
    temporaryDirectories.push(root);
    const dbPath = join(root, '.state', 'recon.sqlite');
    const hubRoute = join(root, 'minion_hub', 'src', 'routes', 'api', 'things', '[id]');
    const gatewayCore = join(root, 'minion', 'src', 'gateway', 'server-core');
    await mkdir(hubRoute, { recursive: true });
    await mkdir(gatewayCore, { recursive: true });
    await writeFile(
      join(hubRoute, '+server.ts'),
      `import type { RequestHandler } from '@sveltejs/kit';
export const GET: RequestHandler = async () => new Response('ok');
export async function PATCH() { return new Response('ok'); }
`,
    );
    await writeFile(
      join(gatewayCore, 'server-methods-list.ts'),
      `export const BASE_METHODS = [
  "health",
  "chat.send",
];
export const GATEWAY_EVENTS = [
  "connect.challenge",
  "chat",
];
`,
    );

    const result = await scanArchitecture({
      root,
      dbPath,
      now: '2026-07-24T00:00:00.000Z',
    });
    expect(result.evidence).toMatchObject({
      httpEndpoints: 2,
      gatewayMethods: 2,
      gatewayEvents: 2,
    });

    const db = new Database(dbPath);
    const endpoints = db
      .query<{ method: string; route_template: string }, []>(
        'SELECT method, route_template FROM http_endpoints ORDER BY method',
      )
      .all();
    const methods = db
      .query<{ name: string }, []>(
        `SELECT name FROM gateway_contracts
				 WHERE contract_kind = 'method' ORDER BY name`,
      )
      .all();
    const symbol = db
      .query<{ name: string }, []>(
        `SELECT name FROM source_symbols
				 WHERE path LIKE '%/+server.ts' AND name = 'GET'`,
      )
      .get();
    db.close();

    expect(endpoints).toEqual([
      { method: 'GET', route_template: '/api/things/<id>' },
      { method: 'PATCH', route_template: '/api/things/<id>' },
    ]);
    expect(methods.map((row) => row.name)).toEqual(['chat.send', 'health']);
    expect(symbol?.name).toBe('GET');
  });
});
