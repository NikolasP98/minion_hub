/**
 * Executable no-key regression test for the standalone backfill entrypoint
 * (S3 follow-up of specs/2026-08-17-pkg-dev-crypto-failopen-spec.md).
 *
 * `hooks.server.ts`'s boot assertion only runs when the SvelteKit server
 * process starts. This script is a separate, documented entrypoint
 * (`bun run src/server/scripts/backfill-google-identities.ts`) that reaches
 * the same `encryptAdc()` path via `attachGoogleIdentity`, so it needs its
 * own fail-closed check. This spawns the real script as a subprocess — not a
 * unit test of the shared resolver, which `crypto-key.test.ts` already covers
 * — to prove the entrypoint itself refuses to run unconfigured.
 *
 * `--no-env-file` matters: bun auto-loads `.env`, and this repo's
 * `.env.example` ships `MINION_ALLOW_DEV_CRYPTO_KEY=1` for local dev. Without
 * the flag this test would silently pass through the opt-in instead of
 * exercising the no-key path.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SCRIPT = path.join('src', 'server', 'scripts', 'backfill-google-identities.ts');

/** Minimal, explicit env — no ambient ENCRYPTION_KEY leaking in from the test runner's own process.env (src/server/test-utils/setup.ts sets one for every other test file). */
function runScript(extraEnv: Record<string, string>): { status: number; stderr: string } {
  try {
    const stdout = execFileSync('bun', ['--no-env-file', 'run', SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
        // Configured-key cases may proceed as far as the query. Keep them
        // isolated from the developer's on-disk database.
        TURSO_DB_URL: 'file::memory:',
        ...extraEnv,
      },
      timeout: 30_000,
    });
    return { status: 0, stderr: stdout };
  } catch (err) {
    const e = err as { status: number | null; stderr: Buffer | string };
    return { status: e.status ?? 1, stderr: String(e.stderr) };
  }
}

describe('backfill-google-identities fails closed without a crypto key', () => {
  it('refuses to run — before reaching any encrypt-capable code — when neither ENCRYPTION_KEY nor the dev-key opt-in is set', () => {
    const { status, stderr } = runScript({});
    expect(status).not.toBe(0);
    expect(stderr).toContain('ENCRYPTION_KEY is not set');
    expect(stderr).toContain('MINION_ALLOW_DEV_CRYPTO_KEY=1');
    // A guard that ran too late would fail on the unrelated, pre-existing
    // `$server` alias resolution gap instead (TODO(handoff) in the script) —
    // that failure mode must never be what this test observes.
    expect(stderr).not.toContain('Cannot find module');
  });

  it('gets past the guard — no refusal — once the dev-key opt-in is set', () => {
    const { stderr } = runScript({ MINION_ALLOW_DEV_CRYPTO_KEY: '1' });
    expect(stderr).not.toContain('Refusing to seal or open secrets');
    expect(stderr).not.toContain('Cannot find module');
  });

  it('gets past the guard — no refusal — once a real ENCRYPTION_KEY is set', () => {
    const { stderr } = runScript({ ENCRYPTION_KEY: 'a-real-key' });
    expect(stderr).not.toContain('Refusing to seal or open secrets');
    expect(stderr).not.toContain('ENCRYPTION_KEY environment variable must be set');
    expect(stderr).not.toContain('Cannot find module');
  });
});
