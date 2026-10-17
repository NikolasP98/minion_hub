import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const roots: string[] = [];
const script = resolve('scripts/design-lint.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'design-lint-contract-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'src/legacy.svelte'), '<div style="color: #ffffff">Text</div>');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('add', 'src');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DESIGN_LINT_ROOT: root,
        DESIGN_LINT_BASE_REF: '',
        GITHUB_BASE_REF: '',
      },
      encoding: 'utf8',
    });
  return { root, run };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('enforcing design debt checks', { timeout: 30_000 }, () => {
  it('uses the Hub registered base and rejects a missing base without --ci', () => {
    const { run } = fixture();
    expect(run().status).toBe(0);
    const missing = run('--base-ref', 'origin/missing');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('unavailable');
  });
  it('rejects debt transferred to an untracked file even when totals stay equal', () => {
    const { root, run } = fixture();
    writeFileSync(join(root, 'src/legacy.svelte'), '<div>Text</div>');
    writeFileSync(join(root, 'src/new.svelte'), '<div style="color: #ffffff">Text</div>');
    expect(run().status).toBe(1);
  });
  it('accepts decreases and catches new CSS debt', () => {
    const { root, run } = fixture();
    writeFileSync(join(root, 'src/legacy.svelte'), '<div>Text</div>');
    expect(run().status).toBe(0);
    writeFileSync(join(root, 'src/new.css'), '.example { z-index: 99; color: #ffffff; }');
    const regression = run();
    expect(regression.status).toBe(1);
    expect(regression.stdout).toContain('src/new.css');
  });
});
describe('global ceilings', { timeout: 30_000 }, () => {
  it('--strict-global fails on a seeded over-ceiling total and passes at the ceiling', () => {
    const { root, run } = fixture();
    const baseline = (rawColor: number) =>
      writeFileSync(
        join(root, 'scripts/.design-lint-baseline.json'),
        JSON.stringify({ totals: { 'raw-color': rawColor } }),
      );
    baseline(0);
    const over = run('--ci', '--strict-global');
    expect(over.status).toBe(1);
    expect(over.stdout).toContain('OVER global ceiling');
    expect(run('--update-baseline').status).toBe(1);
    baseline(1);
    expect(run('--ci', '--strict-global').status).toBe(0);
  });
});
