import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'operator-bootstrap.smoke.ts');
const run = (args: string[], timeout = 240_000) =>
  spawnSync('bun', ['--no-env-file', SCRIPT, ...args], {
    encoding: 'utf8',
    timeout,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  });

describe('operator bootstrap smoke', () => {
  it('rejects unknown phases and flags with exit 2', () => {
    expect(run(['--phase', 'nope']).status).toBe(2);
    expect(run(['--bogus']).status).toBe(2);
  });
  it('refuses the audit phase here: it needs a real owned GoTrue and PostgreSQL', () => {
    const r = run(['--phase', 'audit']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('phase_requires_real_gotrue');
  });
  it('foundation phase loads the real closed graph in a fresh process with zero listeners and no pool slots', () => {
    const r = run(['--phase', 'foundation']);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(report).toMatchObject({
      result: 'foundation_checks_passed',
      checks: { allRootsLoaded: true, zeroListenAttempts: true, noGlobalPoolSlots: true },
    });
  }, 300_000);
});
