import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
